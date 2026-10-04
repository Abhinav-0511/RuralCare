# RuralCare

**Offline-first AI symptom triage for rural patients in low-bandwidth areas.**

> ⚠️ RuralCare gives **triage guidance, not a diagnosis**. In an emergency, call **108** or go to the nearest hospital.

Rural patients often have no doctor nearby, and most AI symptom checkers need a fast internet connection. RuralCare runs triage **on the device**. That means:

- patients get instant guidance with no connection at all,
- fewer people make unnecessary trips to the clinic, and real emergencies are flagged right away,
- data syncs to health workers and doctors once connectivity returns.

The app supports English, Tamil (தமிழ்) and Hindi (हिन्दी).

---

## Architecture at a glance

| Layer          | Tech                                                                                                              | Folder                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Frontend (PWA) | React + TypeScript (Vite), TailwindCSS, vite-plugin-pwa / Workbox, Dexie.js (IndexedDB), onnxruntime-web, i18next | [`client/`](client/)         |
| API            | Node.js + Express (TypeScript), Mongoose, JWT + RBAC, Zod                                                         | [`server/`](server/)         |
| AI service     | Python FastAPI, scikit-learn → ONNX (skl2onnx)                                                                    | [`ai-service/`](ai-service/) |
| Primary DB     | MongoDB (users, triage sessions, sync records)                                                                    | —                            |
| Time-series DB | TimescaleDB (PostgreSQL) for patient vitals                                                                       | —                            |
| Edge           | Eclipse Mosquitto (MQTT) + Python vitals simulator                                                                | [`edge/`](edge/)             |
| Infra          | Docker Compose (now), Kafka + Kubernetes (later)                                                                  | [`infra/`](infra/)           |
| Docs           | Architecture, API docs, report notes                                                                              | [`docs/`](docs/)             |

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

| Role            | Can do                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| `patient`       | Run triage, view their own history and vitals                                           |
| `health_worker` | Run triage on behalf of patients (ASHA / field-worker workflow), view assigned patients |
| `doctor`        | Review triage sessions and vitals, add notes                                            |
| `admin`         | Manage users, roles, model versions                                                     |

---

## Repository layout

```
/shared       Single source of truth: red-flag rules, symptom vocabulary, triage levels (+ TS rule engine)
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

# 2. Start the full stack
docker compose -f infra/docker-compose.yml up --build

# 3. Load demo data (6 villages near Chennai, staff, 18 patients, 80 triage sessions)
docker compose -f infra/docker-compose.yml exec server node server/dist/seed.js

# ...or just the infrastructure, for local development
docker compose -f infra/docker-compose.yml up -d mongodb timescaledb mosquitto
```

**Demo logins.** Every account uses the password `RuralCare@123`. The seed wipes existing data.

| Role          | Phone                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| admin         | 9000000001                                                                                                           |
| doctor        | 9000000002, 9000000003                                                                                               |
| health_worker | 9000000011 (Kelambakkam, Thiruporur) · 9000000012 (Uthiramerur, Sriperumbudur) · 9000000013 (Ponneri, Gummidipoondi) |
| patient       | 9000000021                                                                                                           |

The server, ai-service and client images are built with the **repo root** as their context, so each image can include `/shared`.

| Service      | URL / port                                                              |
| ------------ | ----------------------------------------------------------------------- |
| Client (PWA) | http://localhost:8080                                                   |
| API server   | http://localhost:4000 (Swagger UI at `/api/docs`)                       |
| AI service   | http://localhost:8000 (docs at `/docs`)                                 |
| MongoDB      | `localhost:27017`                                                       |
| TimescaleDB  | `localhost:5433` (host port 5433 avoids clashing with a local Postgres) |
| Mosquitto    | `localhost:1883` (MQTT), `localhost:9001` (WebSockets)                  |

> Each service's code arrives phase by phase. See the roadmap in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#delivery-phases).

## Local development and tests

Prerequisites: Node.js ≥ 20.19 (24 recommended) and Python 3.11+.

```bash
# JS/TS: npm workspaces (shared, server, client)
npm install
npm run dev:server         # http://localhost:4000 (needs MongoDB, e.g. the docker one)
npm run seed -w @ruralcare/server   # load demo data
npm run dev:client         # http://localhost:5173
npm test                   # vitest in every workspace (server tests use an in-memory MongoDB)
npm run lint && npm run typecheck && npm run format:check

# Python AI service
cd ai-service
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt    # .venv/bin/pip on macOS/Linux
.venv/Scripts/python -m pytest
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .
.venv/Scripts/uvicorn app.main:app --reload           # http://localhost:8000/docs
```

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all of the above and builds the Docker images on every push.

---

## Safety rules

Full details and deliberate trade-offs are in **[docs/SAFETY.md](docs/SAFETY.md)**.

- This is **triage guidance, not a diagnosis**, and every result screen shows a disclaimer.
- Red-flag symptoms **always** return `EMERGENCY — call 108 / go to the nearest hospital now`. A deterministic rule engine produces this result, and the ML model is never involved.
- The rule engine runs **before** the model on every path: offline client, online server, and AI service.
- If the AI service is unavailable, triage still works on the rules alone. The result is at least `SEE_DOCTOR_SOON` and says that the model was unavailable. It is never a silent `SELF_CARE`.
- Age is required. If an offline record arrives without age and shows fever, the result is at least `SEE_DOCTOR_24H`.
- Rule definitions live in a single shared source ([`shared/`](shared/README.md)). The TypeScript and Python engines must both pass the same golden test cases, so the offline and online paths cannot drift apart.
