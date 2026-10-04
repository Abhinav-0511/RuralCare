# GramHealth

**Offline-first AI symptom triage for rural patients in low-bandwidth areas.**

> ⚠️ GramHealth gives **triage guidance, not a diagnosis**. In an emergency, call **108** or go to the nearest hospital.

Rural patients often have no doctor nearby, and most AI symptom checkers need a fast internet connection. GramHealth runs triage **on the device**. That means:

- patients get instant guidance with no connection at all,
- fewer people make unnecessary trips to the clinic, and real emergencies are flagged right away,
- data syncs to health workers and doctors once connectivity returns.

The app supports English, Tamil (தமிழ்) and Hindi (हिन्दी).

---

## Architecture at a glance

| Layer | Tech | Folder |
|---|---|---|
| Frontend (PWA) | React + TypeScript (Vite), TailwindCSS, vite-plugin-pwa / Workbox, Dexie.js (IndexedDB), onnxruntime-web, i18next | [`client/`](client/) |
| API | Node.js + Express (TypeScript), Mongoose, JWT + RBAC, Zod | [`server/`](server/) |
| AI service | Python FastAPI, scikit-learn → ONNX (skl2onnx) | [`ai-service/`](ai-service/) |
| Primary DB | MongoDB (users, triage sessions, sync records) | — |
| Time-series DB | TimescaleDB (PostgreSQL) for patient vitals | — |
| Edge | Eclipse Mosquitto (MQTT) + Python vitals simulator | [`edge/`](edge/) |
| Infra | Docker Compose (now), Kafka + Kubernetes (later) | [`infra/`](infra/) |
| Docs | Architecture, API docs, report notes | [`docs/`](docs/) |

The full component diagram and the online and offline data flows are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

### How triage works

```
symptoms ──► RED-FLAG RULE ENGINE ──(red flag hit)──► EMERGENCY — call 108 / go to nearest hospital now
                    │
                (no red flag)
                    ▼
             ML model (ONNX) ──► disease probabilities ──► triage mapping ──► SEE_DOCTOR_24H | SEE_DOCTOR_SOON | SELF_CARE
```

1. **The rule engine always runs first.** It is deterministic and runs both offline in the browser and online on the server and AI service. Red-flag symptoms skip the ML model entirely:
   chest pain, difficulty breathing, unconsciousness, severe bleeding, stroke signs, seizures, high fever in infants, and bleeding during pregnancy.
2. **When no red flag is present, the ML model runs.** Offline, it runs in the browser through `onnxruntime-web`. Online, it runs in the FastAPI service.
3. **Every result shows a disclaimer.** Triage levels are `EMERGENCY`, `SEE_DOCTOR_24H`, `SEE_DOCTOR_SOON` and `SELF_CARE`.

### Roles

| Role | Can do |
|---|---|
| `patient` | Run triage, view their own history and vitals |
| `health_worker` | Run triage on behalf of patients (ASHA / field-worker workflow), view assigned patients |
| `doctor` | Review triage sessions and vitals, add notes |
| `admin` | Manage users, roles, model versions |

---

## Repository layout

```
/client       React TS PWA (offline triage, IndexedDB, ONNX inference, i18n)
/server       Express TS API (auth, triage sync, vitals ingest from MQTT)
/ai-service   FastAPI service + model training / ONNX export scripts
/edge         MQTT vitals device simulator (Python)
/infra        docker-compose.yml, mosquitto config, k8s manifests (later)
/docs         ARCHITECTURE.md, API docs, report notes
```

---

## Getting started (Docker)

Prerequisites: Docker Desktop with Compose v2.

```bash
# 1. Create env files from the templates
cp infra/.env.example      infra/.env
cp server/.env.example     server/.env
cp ai-service/.env.example ai-service/.env
cp client/.env.example     client/.env
cp edge/.env.example       edge/.env

# 2. Start the infrastructure (this works now)
docker compose -f infra/docker-compose.yml up -d mongodb timescaledb mosquitto

# 3. Start the full stack (after Phase 1 adds the app code)
docker compose -f infra/docker-compose.yml up --build
```

| Service | URL / port |
|---|---|
| Client (PWA) | http://localhost:8080 |
| API server | http://localhost:4000 |
| AI service | http://localhost:8000 (docs at `/docs`) |
| MongoDB | `localhost:27017` |
| TimescaleDB | `localhost:5433` (host port 5433 avoids clashing with a local Postgres) |
| Mosquitto | `localhost:1883` (MQTT), `localhost:9001` (WebSockets) |

> Each service's code arrives phase by phase. See the roadmap in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#delivery-phases).

---

## Safety rules

- This is **triage guidance, not a diagnosis**, and every result screen shows a disclaimer.
- Red-flag symptoms **always** return `EMERGENCY — call 108 / go to the nearest hospital now`. A deterministic rule engine produces this result, and the ML model is never involved.
- The rule engine runs **before** the model on every path: offline client, online server, and AI service.
- Rule definitions live in a single shared source, so the offline and online paths cannot drift apart.
