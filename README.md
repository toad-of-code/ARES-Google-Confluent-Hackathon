# ARES-Google-Confluent-Hackathon
---

# 🛡️ ARES: Autonomous Rover Evaluation System 

**ARES** is a production-grade Event-Driven Architecture (EDA) designed for autonomous space exploration. It acts as a "Mission Control" nervous system, ingesting live rover imagery, quantifying environmental hazards using Generative AI, and calculating confidence intervals to prevent autonomous hallucinations.

## 🧠 System Architecture

ARES operates on a decoupled, asynchronous architecture using **Apache Kafka** as the central data backbone:

1. **Uplink & Bridge (`bridge_3.py`):** Acts as the gateway, fetching raw imagery from Mars rovers (via Nebulum/NASA APIs) and streaming them into Kafka topics.
2. **ARES Core (`orbiter_final_2.py`):** The AI engine. It consumes imagery, performs Multi-Pass Analysis using **Google Vertex AI (Gemini 2.5)**, and generates telemetry.
* *Key Feature:* **Variance Analysis** — ARES runs 3 separate inference passes per image to calculate a "Confidence Score." If the AI's variance is high (>20.0), it flags the data as unstable.


3. **Telemetry Stream:** Structured risk data (Hazard Score, Scientific Value) is broadcast via WebSockets to the Mission Control UI and archived in **Google BigQuery**.
4. **Sentinel (`slack_notifier.py`):** A standalone microservice that listens for `mission_alerts`. If ARES detects a Critical Hazard (>7) or High Uncertainty, it instantly dispatches a Slack notification with evidence.

## 🛠️ Tech Stack

* **AI & Cloud:** Google Vertex AI (Gemini 2.5 Flash), Google Cloud Storage, BigQuery.
* **Messaging:** Apache Kafka (Confluent Cloud) using SASL_SSL security.
* **Backend:** Python 3.9+, FastAPI, `confluent-kafka`.
* **Frontend:** React (Vite), Tailwind CSS, Recharts (Real-time telemetry visualization).

## 📂 Component Map

* `orbiter_final_2.py` - **ARES Core.** The primary AI processor. Connects to `rover_uplink` and produces to `orbiter_telemetry`.
* `bridge_3.py` - **Comms Bridge.** Handles external API fetching, Kafka producing, and WebSocket broadcasting to the UI.
* `slack_notifier.py` - **Alert Sentinel.** Listens for critical events and notifies human operators.
* `App.jsx` - **Mission Control Dashboard.** Visualizes hazard trends, rover feeds, and diagnostic logs.

## 🚀 Getting Started

### 1. Prerequisites

* Python 3.9+ & Node.js
* Google Cloud Project (Vertex AI & BigQuery enabled)
* Confluent Cloud Account (Kafka)
* Slack Webhook URL

### 2. Environment Variables

Create a `.env` file in your backend directory:

```bash
GOOGLE_PROJECT_ID=your_project_id
GCS_BUCKET_NAME=your_bucket
BOOTSTRAP_SERVERS=your_kafka_broker
KAFKA_API_KEY=your_key
KAFKA_API_SECRET=your_secret
SLACK_WEBHOOK=your_slack_url

```

### 3. Mission Launch

**Terminal 1: Start the Comms Bridge**

```bash
python bridge_3.py

```

**Terminal 2: Activate ARES Core**

```bash
python orbiter_final_2.py

```

**Terminal 3: Enable Sentinel**

```bash
python slack_notifier.py

```

**Terminal 4: Launch Dashboard**

```bash
npm run dev

```

## 🎮 Usage Protocol

1. **Initialize:** Open Mission Control at `http://localhost:5173`.
2. **Target:** Select a Rover (e.g., Perseverance) and an Earth Date.
3. **Uplink:** Click **"UPLINK"**. This triggers `bridge_3.py` to fetch imagery and push to Kafka.
4. **Monitor:**
* **ARES Core** analyzes images for terrain hazards and scientific value.
* **Dashboard** updates graphs in real-time via WebSockets.
* **Sentinel** alerts Slack if a STOP condition (Hazard > 7) is met.



## 📊 Safety Protocols

ARES implements a **Human-in-the-Loop** safety mechanism based on statistical variance:

* **Critical Hazard:** If Hazard Score > 7 → **AUTO-STOP** signal sent.
* **High Uncertainty:** If the AI's internal variance > 20.0 (meaning the model is "confused") → **HUMAN REVIEW REQ** signal sent, regardless of the hazard score.