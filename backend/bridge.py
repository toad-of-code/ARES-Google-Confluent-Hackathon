import asyncio
import json
import logging
import sys
import os
import datetime
import requests
import random
from collections import defaultdict
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from confluent_kafka import Consumer, Producer
from dotenv import load_dotenv
from google.cloud import bigquery

load_dotenv()

# --- PRE-FLIGHT ---
if not os.getenv('BOOTSTRAP_SERVERS'):
    sys.exit("❌ ERROR: BOOTSTRAP_SERVERS missing from .env")

# --- KAFKA CONFIG ---
KAFKA_COMMON_CONF = {
    "bootstrap.servers": os.getenv('BOOTSTRAP_SERVERS'),
    "security.protocol": "SASL_SSL",
    "sasl.mechanisms": "PLAIN",
    "sasl.username": os.getenv('KAFKA_API_KEY'),    
    "sasl.password": os.getenv('KAFKA_API_SECRET'), 
}

CONSUMER_CONF = KAFKA_COMMON_CONF.copy()
CONSUMER_CONF.update({
    "group.id": "dashboard-bridge-commander-v2", 
    "auto.offset.reset": "latest"
})

PRODUCER_CONF = KAFKA_COMMON_CONF.copy()
producer = Producer(PRODUCER_CONF)

# 1️⃣ UPDATE: Added Flink Output Topic
TOPICS = ["rover_uplink", "orbiter_telemetry", "mission_alerts", "ROVER_SAFETY_TRENDS"]
NEBULUM_BASE_URL = "https://rovers.nebulum.one/api/v1/rovers"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Bridge")

# --- BIGQUERY ---
try:
    bq_client = bigquery.Client()
    logger.info("✅ BigQuery Client Initialized")
except Exception:
    bq_client = None

# --- STATE MANAGEMENT ---
active_connections = []

def create_queue():
    return asyncio.Queue()

rover_queues = defaultdict(create_queue)

# --- REQUEST MODEL ---
class MissionRequest(BaseModel):
    earth_date: str
    rover_name: str 

def delivery_report(err, msg):
    if err is not None: print(f'❌ Delivery failed: {err}')

def robust_json_parser(raw_val):
    try:
        data = json.loads(raw_val)
        if isinstance(data, str): return robust_json_parser(data)
        return data
    except json.JSONDecodeError: return None

async def broadcast(packet):
    disconnected = []
    for websocket in active_connections:
        try:
            await websocket.send_json(packet)
        except Exception:
            disconnected.append(websocket)
    for d in disconnected:
        active_connections.remove(d)

async def kafka_consumer_loop():
    logger.info("🎧 Commander Bridge listening...")
    consumer = Consumer(CONSUMER_CONF)
    consumer.subscribe(TOPICS)

    try:
        while True:
            msg = await asyncio.to_thread(consumer.poll, 0.1)
            if msg is None: 
                await asyncio.sleep(0.01)
                continue
            if msg.error(): continue

            try:
                # topic = msg.topic()
                # raw_val = msg.value().decode('utf-8',errors="ignore")
                # data = robust_json_parser(raw_val)
                # if not isinstance(data, dict): continue
                
                # --- INSIDE kafka_consumer_loop ---
                topic = msg.topic()
                
                # Retrieve the raw bytes directly
                raw_bytes = msg.value()
                raw_val = None

                # CHECK: Is this a Confluent Schema Registry message?
                # It always starts with a Magic Byte of 0 (null byte)
                if len(raw_bytes) > 5 and raw_bytes[0] == 0:
                    try:
                        # ✅ FIX: Skip the first 5 bytes (Header) and decode the rest
                        raw_val = raw_bytes[5:].decode('utf-8')
                    except Exception:
                        # Fallback if it fails
                        raw_val = raw_bytes.decode('utf-8', errors='ignore')
                else:
                    # Standard JSON (like your Python scripts send)
                    raw_val = raw_bytes.decode('utf-8')
                
                # Now parse the clean JSON string
                data = robust_json_parser(raw_val)
                
                if not isinstance(data, dict): continue

                rover_id = data.get("rover_id", "Unknown")

                # --- TOPIC HANDLERS ---
                
                if topic == "rover_uplink":
                    await rover_queues[rover_id].put(data)
                    logger.info(f"📥 Queued Image Context for {rover_id}")
                    
                    await broadcast({
                        "type": "LOG", 
                        "data": {"msg": f"Uplink Established: {rover_id}", "type": "info"}
                    })

                elif topic == "orbiter_telemetry":
                    matched_image = None
                    try:
                        matched_image = rover_queues[rover_id].get_nowait()
                        rover_queues[rover_id].task_done()
                        logger.info(f"✨ MATCH FOUND for {rover_id}")
                    except asyncio.QueueEmpty:
                        logger.warning(f"⚠️ Telemetry received for {rover_id} but no matching Uplink data found.")
                        matched_image = None
                    
                    if matched_image:
                        await broadcast({
                            "type": "UPLINK",
                            "data": {
                                "image_url": matched_image.get("img_src"),
                                "sol": matched_image.get("sol"),
                                "earth_date": matched_image.get("earth_date"), 
                                "rover": rover_id,
                                "camera": matched_image.get("camera")
                            }
                        })
                    
                    await broadcast({"type": "TELEMETRY", "data": data})

                elif topic == "mission_alerts":
                    await broadcast({"type": "ALERT", "data": data})

                # 2️⃣ UPDATE: Flink Trend Handler
                elif topic == "ROVER_SAFETY_TRENDS":
                    # Flink sends flat JSON: {"rover_id": "curiosity", "avg_hazard": 4.5, ...}
                    await broadcast({
                        "type": "TREND",
                        "data": {
                            "avg_hazard": data.get("avg_hazard"),
                            "count": data.get("readings_count")
                        }
                    })

            except Exception as e:
                logger.error(f"Processing Error: {e}")
    finally:
        consumer.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(kafka_consumer_loop())
    yield
    task.cancel()

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/trigger_mission")
async def trigger_mission(mission: MissionRequest):
    logger.info(f"🕹️ UI Triggered Mission: {mission.rover_name.upper()} on {mission.earth_date}")
    
    rover_slug = mission.rover_name.lower()
    url = f"{NEBULUM_BASE_URL}/{rover_slug}/photos?earth_date={mission.earth_date}"
    
    try:
        logger.info(f"📡 Requesting: {url}")
        resp = requests.get(url)
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=500, detail="External API Unreachable")

    all_photos = data.get("photos", [])
    if not all_photos:
        raise HTTPException(status_code=404, detail=f"No photos found for {mission.rover_name} on this date.")

    if len(all_photos) > 5:
        mission_photos = random.sample(all_photos, 5)
    else:
        mission_photos = all_photos
    asyncio.create_task(stream_photos_to_kafka(mission_photos, mission.earth_date, mission.rover_name.upper()))

    return {"status": "Mission Started", "rover": mission.rover_name, "count": len(mission_photos)}

async def stream_photos_to_kafka(photos, earth_date, rover_id):
    for i, photo in enumerate(photos):
        uplink_packet = {
            "rover_id": rover_id,
            "sol": photo.get("sol"),
            "camera": photo.get("camera", {}).get("name", "NAVCAM"),
            "img_src": photo.get("img_src"),
            "mission_phase": "AUTOMATED_EXPLORATION",
            "earth_date": earth_date,
            "timestamp": int(datetime.datetime.now().timestamp() * 1000)
        }

        try:
            # 3️⃣ UPDATE: Added Key to Producer (Fixes Flink "Null Key" error)
            producer.produce(
                "rover_uplink", 
                key=rover_id.encode('utf-8'),  # <--- CRITICAL FIX
                value=json.dumps(uplink_packet).encode('utf-8'), 
                callback=delivery_report
            )
            producer.poll(0)
            
            await broadcast({
                "type": "LOG", 
                "data": {"msg": f"Transmitting Packet {i+1}/{len(photos)} for {rover_id}...", "type": "info"}
            })

        except Exception as e:
            logger.error(f"Stream Error: {e}")

        await asyncio.sleep(2) 

    await broadcast({
        "type": "LOG", 
        "data": {"msg": f"✅ {rover_id} Transmission Complete.", "type": "success"}
    })

# --- HISTORY API ---
@app.get("/history")
async def get_mission_history():
    if not bq_client: return []
    
    # 1. UPDATE: Correct Table ID (Make sure this matches your actual table)
    table_id = os.getenv("GOOGLE_BIGQUERY_TABLE")
    
    # 2. UPDATE: Select MORE columns (added img_src, scientific_value, analysis_text)
    query = f"""
        SELECT 
            rover_id, sol, hazard_score, terrain_type, event_time, 
            scientific_value, analysis_text, img_src,confidence_variance
        FROM `{table_id}` 
        ORDER BY event_time DESC 
        LIMIT 2
    """
    
    try:
        results = await asyncio.to_thread(bq_client.query(query).result)
        history = []
        for row in results:
            # Format time
            time_str = "--"
            if row.get("event_time"):
                try:
                    dt = datetime.datetime.fromtimestamp(row.get("event_time") / 1000.0)
                    time_str = dt.strftime("%H:%M")
                except: time_str = str(row.get("event_time"))
            
            # 3. UPDATE: Build the full packet structure the frontend expects
            history.append({
                "time": time_str,
                "sol": row.get("sol"),
                "score": row.get("hazard_score"),
                "science": row.get("scientific_value", 0),
                "action": row.get("terrain_type", "Unknown"),
                "fullData": {
                    "rover_id": row.get("rover_id"),
                    "sol": row.get("sol"),
                    "img_src": row.get("img_src"), # Critical for the image viewer
                    "analysis_text": row.get("analysis_text"),
                    "scientific_value": row.get("scientific_value"),
                    "confidence_variance": row.get("confidence_variance"),
                }
            })
        return history
    except Exception as e:
        logger.error(f"History Error: {e}")
        return []

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)