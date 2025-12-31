import json
import os
import requests
from confluent_kafka import Consumer, KafkaException
from dotenv import load_dotenv

load_dotenv()

# --- CONFIGURATION ---
SLACK_WEBHOOK = os.getenv("SLACK_WEBHOOK")

# ⚠️ FILL THESE IN WITH YOUR CONFLUENT CLOUD KEYS ⚠️
KAFKA_API_KEY = os.getenv("KAFKA_API_KEY")
KAFKA_API_SECRET = os.getenv("KAFKA_API_SECRET")

# Kafka Configuration
conf = {
    "bootstrap.servers": os.getenv("BOOTSTRAP_SERVERS"),
    "group.id": "slack-bot-group",  # Unique ID for this consumer group
    "auto.offset.reset": "latest",
    
    # --- REQUIRED FOR CONFLUENT CLOUD ---
    "security.protocol": "SASL_SSL",
    "sasl.mechanisms": "PLAIN",
    "sasl.username": KAFKA_API_KEY,
    "sasl.password": KAFKA_API_SECRET
}

def start_slack_bot():
    consumer = Consumer(conf)
    
    # Subscribe to the topic defined in your Orbiter
    consumer.subscribe(["mission_alerts"])

    print("🎧 Slack Notifier is listening for alerts...")

    try:
        while True:
            msg = consumer.poll(1.0) # Wait 1 second for messages

            if msg is None:
                continue
            if msg.error():
                print(f"❌ Kafka Error: {msg.error()}")
                continue

            try:
                # 1. Parse the incoming message
                alert = json.loads(msg.value().decode('utf-8'))
                
                # 2. Construct the Slack Payload
                payload = {
                    "text": f"""
🚨 *CRITICAL MARS ALERT*
*Rover:* {alert.get('rover_id', 'Unknown')}
*Hazard Level:* {alert.get('hazard_level', 'Unknown')}
*Action:* {alert.get('action', 'N/A')}
📸 *Evidence:* {alert.get('evidence_url', 'No Image')}
"""
                }

                # 3. Send to Slack
                response = requests.post(SLACK_WEBHOOK, json=payload)
                
                if response.status_code == 200:
                    print(f"✅ Alert sent to Slack for Rover {alert.get('rover_id')}")
                else:
                    print(f"⚠️ Slack Error {response.status_code}: {response.text}")

            except json.JSONDecodeError:
                print(f"⚠️ Received invalid JSON: {msg.value()}")
            except KeyError as e:
                print(f"⚠️ Missing key in alert data: {e}")

    except KeyboardInterrupt:
        print("\n🛑 Stopping Slack Bot...")
    finally:
        consumer.close()

if __name__ == "__main__":
    start_slack_bot()