# RuralCare — Architecture

## 1. Component diagram

```mermaid
flowchart LR
    subgraph Device["📱 Patient / Health-worker device (PWA)"]
        UI["React + TS UI<br/>Tailwind · i18n (en/ta/hi)"]
        SW["Service Worker<br/>Workbox precache"]
        RE_C["Red-flag Rule Engine<br/>(TS, deterministic)"]
        ONNX_C["onnxruntime-web<br/>triage model .onnx"]
        DEX[("IndexedDB<br/>Dexie.js<br/>sessions · outbox · model cache")]
        UI --> RE_C
        RE_C -- "no red flag" --> ONNX_C
        UI <--> DEX
        SW -. "caches app shell + model" .-> ONNX_C
    end

    subgraph Backend["🖥️ Backend (Docker Compose)"]
        API["Express API (TS)<br/>JWT + RBAC · Zod"]
        RE_S["Red-flag Rule Engine<br/>(TS, same rules)"]
        AI["FastAPI AI service<br/>Rule Engine (Py) + sklearn/ONNX"]
        MONGO[("MongoDB<br/>users · triage sessions · audit")]
        TSDB[("TimescaleDB<br/>vitals hypertable")]
        MQTT{{"Mosquitto<br/>MQTT broker"}}
        API --> RE_S
        API -- "REST /predict" --> AI
        API <--> MONGO
        API <--> TSDB
        MQTT -- "subscribe vitals/#" --> API
    end

    subgraph Edge["📟 Edge"]
        SIM["Vitals simulator (Python)<br/>HR · SpO₂ · Temp · BP"]
    end

    RULES[/"/shared<br/>red-flag rules · symptoms · triage levels<br/>(single JSON source)"/]
    RULES -. "bundled at build" .-> RE_C
    RULES -. "bundled at build" .-> RE_S
    RULES -. "loaded at start" .-> AI

    SIM -- "publish vitals/{deviceId}" --> MQTT
    UI <-- "HTTPS (when online)<br/>auth · sync · history" --> API
    ONNX_C -. "model download / update" .- API

    subgraph Later["🔜 Later phases"]
        KAFKA[["Kafka"]]
        K8S[["Kubernetes"]]
    end
    MQTT -. "phase 6" .-> KAFKA
```

## 2. Data flows

### 2a. Offline triage path (no connectivity)

```mermaid
sequenceDiagram
    autonumber
    actor P as Patient / Health worker
    participant UI as PWA (React)
    participant RE as Rule Engine (TS)
    participant M as ONNX model (browser)
    participant DB as IndexedDB (Dexie)

    P->>UI: Select symptoms (+ age, pregnancy, duration)
    UI->>RE: evaluate(symptoms, context)
    alt Red flag detected
        RE-->>UI: EMERGENCY (source = "rule", ruleId)
        Note over UI: Model is NOT called.<br/>Show "Call 108 / go to nearest hospital now"
    else No red flag
        RE-->>UI: pass
        UI->>M: run(symptomVector)
        M-->>UI: disease probabilities
        UI->>UI: map → SEE_DOCTOR_24H / SEE_DOCTOR_SOON / SELF_CARE
    end
    UI->>DB: save session to outbox (synced = false)
    UI-->>P: Result + disclaimer (localised)
```

### 2b. Online path and background sync

```mermaid
sequenceDiagram
    autonumber
    participant UI as PWA
    participant DB as IndexedDB outbox
    participant API as Express API
    participant RE as Rule Engine (TS)
    participant AI as FastAPI AI service
    participant MG as MongoDB

    Note over UI: Connectivity restored (online event / Background Sync)
    UI->>DB: read unsynced sessions
    UI->>API: POST /api/triage/sync (JWT)
    API->>API: Zod validate + RBAC
    API->>RE: re-evaluate red flags (server-side check)
    alt Red flag detected
        RE-->>API: EMERGENCY (overrides any client result)
    else No red flag
        API->>AI: POST /predict
        AI->>AI: rule engine (defence in depth) → model
        AI-->>API: level + probabilities + modelVersion
    end
    API->>MG: upsert session (idempotent by clientId)
    API-->>UI: ack + server verdict
    UI->>DB: mark synced, store server verdict
```

### 2c. Vitals path (edge → time-series)

```mermaid
sequenceDiagram
    participant SIM as Vitals simulator
    participant MQ as Mosquitto
    participant API as Express API (MQTT subscriber)
    participant TS as TimescaleDB
    participant DR as Doctor dashboard

    SIM->>MQ: publish vitals/{deviceId} {hr, spo2, temp, bp, ts}
    MQ->>API: deliver message
    API->>API: validate (Zod), map device → patient
    API->>TS: INSERT into vitals hypertable
    API->>API: threshold check (e.g. SpO₂ < 90%) → alert
    DR->>API: GET /api/vitals/:patientId?range=24h
    API->>TS: time_bucket() aggregate query
    TS-->>API: series
    API-->>DR: chart data
```

## 3. Key design decisions

| Decision                                                    | Why                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rule engine runs before the model on every path**         | Safety. Red flags must never depend on probabilistic output. The rules run on the client (offline), on the server (re-check on sync), and in the AI service (defence in depth).                                        |
| **Single shared rules file**                                | One JSON definition is consumed by both the TS and Python engines, so the offline and online paths can't drift. Golden test cases run against both engines.                                                            |
| **Structured symptom selection (checklist), not free text** | Works offline, needs no NLP model, translates easily, and maps directly to the model's feature vector.                                                                                                                 |
| **sklearn → ONNX**                                          | The same model file serves the browser (onnxruntime-web) and the server (onnxruntime in FastAPI). It is small enough to precache.                                                                                      |
| **Disease → triage-level mapping table**                    | The model predicts conditions. A curated mapping (reviewed and documented) turns those predictions into one of the four triage levels. Low-confidence predictions escalate to `SEE_DOCTOR_SOON`, never to `SELF_CARE`. |
| **MongoDB for documents, TimescaleDB for vitals**           | Triage sessions are document-shaped. Vitals are high-frequency time-series that benefit from hypertables and `time_bucket` queries.                                                                                    |
| **Idempotent sync keyed by client-generated UUID**          | Offline devices may retry. Duplicate uploads must be safe.                                                                                                                                                             |
| **Server verdict wins**                                     | If the server-side rule check disagrees with the client (e.g. outdated rules on the client), the server result is stored and shown.                                                                                    |

## 4. Triage levels

| Level             | Meaning                                   | Who decides                                            |
| ----------------- | ----------------------------------------- | ------------------------------------------------------ |
| `EMERGENCY`       | Call 108 / go to the nearest hospital now | Rule engine **only**                                   |
| `SEE_DOCTOR_24H`  | See a doctor within 24 hours              | Model + mapping                                        |
| `SEE_DOCTOR_SOON` | Book a visit in the next few days         | Model + mapping (also the fallback for low confidence) |
| `SELF_CARE`       | Home care advice, monitor symptoms        | Model + mapping (high confidence only)                 |

## Delivery phases

| Phase | Scope                                                                                                                                                                    | Status  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1     | `/shared` rules, vocabulary and triage levels; TS and Python red-flag engines with shared golden tests; npm workspaces, lint/format, health endpoints, Docker builds, CI | ✅ Done |
| 2     | Backend API: Mongoose models, JWT + RBAC, Zod validation, `POST /triage`, idempotent `POST /triage/sync`, OpenAPI docs                                                   | ⏳      |
| 3     | Kaggle dataset, sklearn training, clean + noisy evaluation, ONNX export, disease → triage mapping, FastAPI `/predict`, `docs/MODEL_REPORT.md`                            | ⏳      |
| 4     | MQTT vitals simulator, server subscriber → TimescaleDB hypertable, threshold alerts, Mosquitto auth                                                                      | ⏳      |
| 5     | Offline-first PWA: Workbox, symptom checklist, in-browser rules + ONNX, Dexie outbox sync, en/ta/hi, dashboards                                                          | ⏳      |
| 6     | Kafka, Kubernetes manifests, security hardening, Playwright E2E (incl. offline), Lighthouse, final report                                                                | ⏳      |
