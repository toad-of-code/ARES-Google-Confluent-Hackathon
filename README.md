# ARES-Google-Confluent-Hackathon

# 🛡️ ARES — Autonomous Rover Evaluation System

**ARES** is a production-grade, event-driven intelligence system designed to support autonomous planetary exploration.
It acts as a real-time *mission control layer*, ingesting rover imagery, performing AI-based risk analysis, and enforcing safety decisions using explainable, confidence-aware logic.

---

## 🧠 System Overview

ARES operates as a distributed, fault-tolerant system built for environments where **latency, uncertainty, and safety** are critical.

It combines:

* Real-time image ingestion
* Multi-pass AI reasoning
* Confidence and uncertainty modeling
* Event-driven alerting
* Human-in-the-loop safety enforcement

---

## 🏗️ System Architecture

ARES follows a decoupled, event-driven architecture using **Apache Kafka** as its backbone.

```
[Rover / NASA API]
        ↓
   Kafka (rover_uplink)
        ↓
┌────────────────────┐
│   ARES Core AI     │
│  • Gemini Analysis │
│  • Variance Check  │
└────────┬───────────┘
         │
         ├──► Kafka (telemetry)
         ├──► BigQuery (historical store)
         └──► Kafka (alerts) + Google Cloud Storage(Evidence)
                    ↓
            Slack + Mission Control UI
```

---

## 🧩 Core Components

### 1️⃣ Uplink & Bridge (`bridge.py`)

Fetches rover imagery from external APIs and streams normalized messages into Kafka.

### 2️⃣ ARES Core (`orbiter_final.py`)

The central intelligence engine that:

* Performs multi-pass inference using **Google Gemini 2.5**
* Computes hazard scores and scientific value
* Quantifies model uncertainty via variance analysis
* Emits telemetry and alerts

### 3️⃣ Telemetry & Storage

* Streams structured data to Kafka
* Archives historical records in **Google BigQuery**

### 4️⃣ Sentinel (`slack_notifier.py`)

A standalone service that listens for critical events and sends real-time Slack alerts when safety thresholds are breached.

---

## 🔐 System Guarantees & Assumptions

ARES is designed with strict operational guarantees:

* All incoming data is immutable and timestamped
* Network delays and reordering are expected and tolerated
* Autonomous decisions are never executed without human oversight
* Safety always takes precedence over mission continuity
* All actions are auditable and reproducible

---

## ⚠️ Failure Modes & Recovery

| Failure Type      | Detection Method          | System Response      |
| ----------------- | ------------------------- | -------------------- |
| Kafka outage      | Heartbeat timeout         | Buffer & retry       |
| Model instability | Variance threshold breach | Trigger human review |
| Invalid data      | Schema validation failure | Drop & log           |
| Slack outage      | Delivery failure          | Retry with backoff   |
| Image fetch error | HTTP failure              | Skip frame, continue |

---

## 🧪 Event Schemas

### `mission_alerts`

```json
{
  "alert_id": "uuid",
  "rover_id": "perseverance",
  "hazard_level": 8,
  "variance_level": 21.3,
  "action": "CRITICAL_STOP",
  "evidence_url": "https://...",
  "timestamp": 1710000000
}
```

### `orbiter_telemetry`

```json
{
  "rover_id": "CURIOSITY",
  "sol": 21,
  "hazard_score": 2,
  "confidence_score": 95,
  "confidence_variance": 0,
  "terrain_type": "rocky plain",
  "scientific_value": 7,
  "analysis_text": "AI powered analysis",
  "event_time": 1767201841296
}
```

---

## 🧰 Tech Stack

* **AI / ML:** Google Vertex AI (Gemini 2.5)
* **Messaging:** Apache Kafka (Confluent Cloud)
* **Backend:** Python, FastAPI
* **Frontend:** React, Tailwind CSS, Recharts
* **Storage:** Google BigQuery
* **Infra:** Event-driven microservices

---

## 🚀 Getting Started

### 1️⃣ Prerequisites

* Python 3.9+
* Node.js 18+
* Google Cloud Project (Vertex AI + BigQuery enabled)
* Confluent Cloud account
* Slack webhook URL

### 2️⃣ Setup Environment

```bash
cp .env.example .env
pip install -r req.txt
```

Populate credentials inside `.env` and install requirements.

### 3️⃣ Run the System

```bash
# Start ingestion & processing
python -m uvicorn bridge:app --reload --port 8000
python orbiter_final.py

# Start alerting
python slack_notifier.py

# Launch frontend
cd orbiter-dashboard-frontend
npm install
npm run dev
```

---

## 🧭 Operational Behavior

| Condition        | System Response          |
| ---------------- | ------------------------ |
| Hazard ≤ 7       | Continue mission         |
| Hazard > 7       | Trigger alert            |
| High uncertainty | Require human review     |
| Data loss        | Skip frame, log incident |

---

## 🔮 Roadmap

* Multi-model ensemble reasoning
* Temporal anomaly detection
* Offline simulation & replay mode
* Kubernetes-native deployment
* Role-based access control

---

## 📜 License

This project is licensed under the **MIT License**.
See the [LICENSE](./LICENSE) file for details.

---

## 👨‍🚀 Author

**Rahul Roy**
*AI Systems · Distributed Systems · Autonomous Intelligence*

