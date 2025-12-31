import os
import json
import time
import requests
import uuid
import datetime
import statistics  # <--- 1. NEW IMPORT
from dotenv import load_dotenv
import vertexai
from vertexai.generative_models import GenerativeModel, Part
from confluent_kafka import Consumer, Producer
from google.cloud import storage
from google.cloud import bigquery

# ==========================================
# 1. MISSION CONFIGURATION
# ==========================================
load_dotenv()

PROJECT_ID = os.getenv('GOOGLE_PROJECT_ID')
LOCATION = "us-central1"
BUCKET_NAME = os.getenv('GCS_BUCKET_NAME')
BQ_TABLE_ID = f"{PROJECT_ID}.ares_mission_data.telemetry_logs"

CONF = {
    'bootstrap.servers': os.getenv('BOOTSTRAP_SERVERS'),
    'security.protocol': 'SASL_SSL',
    'sasl.mechanism': 'PLAIN',
    'sasl.username': os.getenv('KAFKA_API_KEY'),
    'sasl.password': os.getenv('KAFKA_API_SECRET'),
    'group.id': 'orbiter-ai-group-final',
    'auto.offset.reset': 'latest'
}

INPUT_TOPIC = "rover_uplink"
TELEMETRY_TOPIC = "orbiter_telemetry"
ALERTS_TOPIC = "mission_alerts"

# ==========================================
# 2. SYSTEM INITIALIZATION
# ==========================================
print("🛰️ INITIALIZING ORBITER AI SYSTEMS...")

try:
    vertexai.init(project=PROJECT_ID, location=LOCATION)
    model = GenerativeModel("gemini-2.5-flash")
    storage_client = storage.Client()
    bq_client = bigquery.Client()
    print("✅ Google Cloud Services Connected")

    consumer = Consumer(CONF)
    consumer.subscribe([INPUT_TOPIC])
    producer = Producer(CONF)
    print("✅ Deep Space Network (Kafka) Connected")

except Exception as e:
    print(f"❌ Initialization Failed: {e}")
    exit(1)

print("\n🚀 ORBITER ONLINE. MONITORING FOR TRANSMISSIONS...\n")

# ==========================================
# 3. HELPER FUNCTIONS
# ==========================================

def analyze_image_with_variance(img_data, iterations=3):
    """
    Runs AI analysis multiple times to calculate stability (variance).
    Returns the average results and the calculated variance.
    """
    image_part = Part.from_data(img_data, mime_type="image/jpeg")
    
    # 2. UPDATED PROMPT WITH CONFIDENCE_SCORE
    prompt = """
Analyze the following Mars rover image and return a JSON object ONLY.

The JSON must contain the following fields:
{
  "hazard_score": integer (0–10),
  "confidence_score": integer (0-100),
  "scientific_value": integer (0–10),
  "terrain_type": string,
  "analysis_text": string
}

CRITICAL RULES FOR "scientific_value":
1. Score is based SOLELY on geological features (rocks, soil, strata, atmosphere).
2. DO NOT assign value to rover hardware, wheels, or selfie components visible in the image.
3. If the image is mostly rover hardware, the scientific_value must be LOW (0-3).

The "analysis_text" field MUST follow this exact structure:

🟡 Terrain Analysis
• <sentence with MAXIMUM 20 words>

⚠️ Risk Factors
• <sentence with MAXIMUM 20 words>

🧠 Scientific Value
• <sentence with MAXIMUM 20 words focusing ONLY on geology, not hardware>

Rules:
- Each section must contain EXACTLY one bullet.
- Each bullet must be 20 words or fewer.
- "terrain_type" must be a short descriptive phrase (e.g., "Rocky plain with scattered boulders").
- Do NOT add extra sections, commentary, or formatting.
- Return valid JSON only.
"""

    results = []
    
    print(f"   🔄 Running Multi-Pass Analysis ({iterations} iterations)...")
    
    for i in range(iterations):
        try:
            # We use a non-zero temperature to allow for natural variance
            response = model.generate_content(
                [prompt, image_part],
                generation_config={"temperature": 0.4} 
            )
            text = response.text.replace('```json', '').replace('```', '').strip()
            data = json.loads(text)
            results.append(data)
        except Exception as e:
            print(f"      ⚠️ Iteration {i+1} failed: {e}")

    if not results:
        return None

    # --- CALCULATE STATISTICS ---
    # Extract scores from all successful iterations
    hazard_scores = [r['hazard_score'] for r in results]
    conf_scores = [r['confidence_score'] for r in results]

    # Calculate Means (Averages)
    avg_hazard = int(statistics.mean(hazard_scores))
    avg_conf = int(statistics.mean(conf_scores))
    
    # Calculate Variance (Standard Deviation)
    # If standard deviation is HIGH, the AI is "confused" (giving different answers)
    if len(conf_scores) > 1:
        variance = round(statistics.stdev(conf_scores), 2)
    else:
        variance = 0.0

    # We take the text/terrain from the LAST successful result (most recent)
    final_result = results[-1]
    
    final_result['hazard_score'] = avg_hazard
    final_result['confidence_mean'] = avg_conf
    final_result['confidence_variance'] = variance
    
    return final_result

def save_evidence(img_data, blob_name):
    try:
        bucket = storage_client.bucket(BUCKET_NAME)
        blob = bucket.blob(blob_name)
        blob.upload_from_string(img_data, content_type="image/jpeg")
        print(f"   💾 Evidence archived: gs://{BUCKET_NAME}/{blob_name}")
        return blob
    except Exception as e:
        print(f"   ❌ Storage Error: {e}")
        return None

def delivery_report(err, msg):
    if err: print(f"❌ Kafka Error: {err}")

# ==========================================
# 4. MAIN MISSION LOOP
# ==========================================
try:
    while True:
        msg = consumer.poll(1.0)
        if msg is None: continue
        if msg.error():
            print(f"Consumer Error: {msg.error()}")
            continue
        
        try:
            raw_data = json.loads(msg.value().decode('utf-8'))
            img_url = raw_data.get('img_src')
            rover_id = raw_data.get('rover_id', 'UNKNOWN')
            sol = raw_data.get('sol')

            print(f"📥 PACKET RECEIVED: {rover_id} | Sol {sol}")

            headers = {"User-Agent": "Mozilla/5.0"}
            response = requests.get(img_url, headers=headers)
            if response.status_code != 200: continue
            img_data = response.content

            # --- CALL NEW FUNCTION ---
            ai_result = analyze_image_with_variance(img_data, iterations=3)
            
            if not ai_result: continue
            
            hazard_score = ai_result['hazard_score']
            variance = ai_result['confidence_variance']
            
            print(f"   🧠 RESULTS: Hazard {hazard_score}/10 | Conf: {ai_result['confidence_mean']}% | Var: {variance}")

            # ---------------------------------------------------------
            # 📡 PATH A: STANDARD TELEMETRY
            # ---------------------------------------------------------
            telemetry_packet = {
                "rover_id": rover_id,
                "sol": sol,
                "hazard_score": hazard_score,
                "confidence_score": ai_result['confidence_mean'], # Log Mean Confidence
                "confidence_variance": variance,                  # Log Stability
                "terrain_type": ai_result['terrain_type'],
                "scientific_value": ai_result['scientific_value'],
                "analysis_text": ai_result['analysis_text'],
                "event_time": int(time.time() * 1000)
            }

            producer.produce(TELEMETRY_TOPIC, json.dumps(telemetry_packet).encode('utf-8'), callback=delivery_report)
            
            errors = bq_client.insert_rows_json(BQ_TABLE_ID, [telemetry_packet])
            if not errors: print("   📊 Telemetry Logged.")
            
            # ---------------------------------------------------------
            # 🚨 PATH B: EMERGENCY ALERT
            # ---------------------------------------------------------
            # Alert if Hazard is High OR if AI is extremely unstable (Variance > 20)
            if hazard_score > 7 or variance > 20.0:
                print("   ⚠️ CRITICAL CONDITION (High Hazard or High Uncertainty)...")

                unique_id = str(uuid.uuid4())[:8]
                blob_name = f"evidence/{rover_id}_Sol{sol}_Haz{hazard_score}_{unique_id}.jpg"
                save_evidence(img_data, blob_name)

                evidence_link = f"https://storage.googleapis.com/{BUCKET_NAME}/{blob_name}"

                alert_packet = {
                    "alert_id": str(uuid.uuid4()),
                    "rover_id": rover_id,
                    "hazard_level": hazard_score,
                    "variance_level": variance, # Include this in alert
                    "action": "CRITICAL_STOP" if hazard_score > 7 else "HUMAN_REVIEW_REQ", # Different action for uncertainty
                    "evidence_url": evidence_link, 
                    "alert_time": int(time.time() * 1000)
                }

                producer.produce(ALERTS_TOPIC, json.dumps(alert_packet).encode('utf-8'), callback=delivery_report)

            producer.flush()
            print("   ------------------------------------------------")

        except Exception as e:
            print(f"   ❌ Processing Error: {e}")

except KeyboardInterrupt:
    print("\n🛑 MISSION ABORTED.")
finally:
    consumer.close()