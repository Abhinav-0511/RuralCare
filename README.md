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

| Layer          | Tech                                                                                                                                                                               | Folder                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Frontend (PWA) | React + TypeScript (Vite), TailwindCSS, vite-plugin-pwa / Workbox, Dexie.js (IndexedDB), built-in ONNX interpreter (onnxruntime-web fallback), en/ta/hi. See [PWA.md](docs/PWA.md) | [`client/`](client/)         |
| API            | Node.js + Express (TypeScript), Mongoose, JWT + RBAC, Zod                                                                                                                          | [`server/`](server/)         |
| AI service     | Python FastAPI + onnxruntime; scikit-learn → ONNX (skl2onnx) training. See [MODEL_REPORT.md](docs/MODEL_REPORT.md)                                                                 | [`ai-service/`](ai-service/) |
| Primary DB     | MongoDB (users, triage sessions, sync records)                                                                                                                                     | —                            |
| Time-series DB | TimescaleDB (PostgreSQL) for patient vitals                                                                                                                                        | —                            |
| Edge           | Eclipse Mosquitto (MQTT, passwords + ACL) + Python vitals simulator                                                                                                                | [`edge/`](edge/)             |
| Infra          | Docker Compose (now), Kafka + Kubernetes (later)                                                                                                                                   | [`infra/`](infra/)           |
| Docs           | Architecture, API docs, report notes                                                                                                                                               | [`docs/`](docs/)             |

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
2. **When no red flag is present, the ML model runs.** Offline, it runs in the browser on a small built-in ONNX interpreter (onnxruntime-web is downloaded only as a fallback; see [ARCHITECTURE.md §5](docs/ARCHITECTURE.md#5-in-browser-model-runtime-decision) for why). Online, it runs in the FastAPI service.
3. **Every result shows a disclaimer.** Triage levels are `EMERGENCY`, `SEE_DOCTOR_24H`, `SEE_DOCTOR_SOON` and `SELF_CARE`.

### Roles

| Role            | Can do                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| _guest_         | No account. Check symptoms (online or offline); the result stays on the phone and is not saved to a health record                                   |
| `patient`       | Run triage, view their own history and vitals. Accounts are created by a health worker only                                                         |
| `health_worker` | Run triage on behalf of patients (ASHA / field-worker workflow), view assigned patients, register patients in their villages, reset their passwords |
| `doctor`        | Review triage sessions and vitals, add notes                                                                                                        |
| `admin`         | Create, edit and deactivate staff accounts, assign villages, manage villages. The only role that can set roles                                      |

### How a new user gets started

There is **no self sign-up**. Accounts come from people the user already knows:

1. **Anyone, no account:** on the login screen, tap **"Check symptoms without an account"**. The full triage works, including offline, with the same safety rules and the Call 108 button. The result is kept only on that phone.
2. **Becoming a patient:** the village **health worker** taps **"Register new patient"** (name, mobile, village, sex, date of birth, language) and can tick **"Create a login"**. The app shows a **temporary password once**; the health worker gives it to the patient.
3. **First login:** the patient logs in with their mobile number and the temporary password, and must **choose their own password**. If they used the app as a guest on that phone, they are asked **"You have N earlier checks on this phone. Add them to your record?"**
4. **Staff:** an **admin** creates health workers and doctors (Users page), assigns villages, and gets a temporary password to hand over. The same first-login rule applies.
5. **Forgot password:** "Forgot password?" on the login screen sends a 6-digit code by SMS (mocked: the code is logged by the server and shown in the app in development). Without access to that phone, the health worker (patients) or admin (staff) can reset it.

Details: [docs/API.md](docs/API.md#onboarding-and-accounts) and [docs/SAFETY.md](docs/SAFETY.md#6-onboarding-guest-triage-and-accounts).

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

**Vitals demo (MQTT → TimescaleDB → alerts → triage).** No extra setup: the seed (step 3) also provisions the MQTT passwords and ACL for the 5 demo devices. Mosquitto reloads itself when they change, and the edge simulator (started with the stack) waits for them, then publishes a reading every 5 s. Re-seeding rotates the credentials and everything reconnects on its own.

```bash
# Inject an abnormal reading on demand (kinds: python -m simulator kinds)
docker compose -f infra/docker-compose.yml exec edge-simulator \
  python -m simulator inject --device rc-dev-03 --kind spo2_critical
```

The critical alert appears in `GET /api/alerts`. A triage for that patient in the next 30 minutes becomes EMERGENCY (`RF_LOW_OXYGEN`), even after normal readings resume.

**Demo logins.** Every account uses the password `RuralCare@123`. The seed (and therefore the e2e suite's setup) wipes existing data. **Forgot-password codes** appear in the server log (`docker compose -f infra/docker-compose.yml logs server`) and, in development, on screen.

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
npm test                   # vitest in every workspace (server tests: in-memory MongoDB, plus
                           # TimescaleDB + Mosquitto containers via Testcontainers; skipped without Docker)
npm run lint && npm run typecheck && npm run format:check

# Python AI service
cd ai-service
# (model is committed; to retrain: python -m training.fetch_dataset && python -m training.train)
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt    # .venv/bin/pip on macOS/Linux
.venv/Scripts/python -m pytest
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .
.venv/Scripts/uvicorn app.main:app --reload           # http://localhost:8000/docs
```

**End-to-end tests (Playwright).** They drive the Docker stack on a 360 px phone viewport and re-seed the database first. Coverage is listed in [docs/PWA.md](docs/PWA.md#6-end-to-end-tests).

```bash
docker compose -f infra/docker-compose.yml up -d --build --wait
npx playwright install chromium        # once
npm run e2e -w @ruralcare/client       # report: client/playwright-report/
```

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all of the above, including the e2e suite against the full stack, and builds the Docker images on every push.

---

## Safety rules

Full details and deliberate trade-offs are in **[docs/SAFETY.md](docs/SAFETY.md)**.

- This is **triage guidance, not a diagnosis**, and every result screen shows a disclaimer.
- Red-flag symptoms **always** return `EMERGENCY — call 108 / go to the nearest hospital now`. A deterministic rule engine produces this result, and the ML model is never involved.
- The rule engine runs **before** the model on every path: offline client, online server, and AI service.
- If the AI service is unavailable, triage still works on the rules alone. The result is at least `SEE_DOCTOR_SOON` and says that the model was unavailable. It is never a silent `SELF_CARE`.
- Age is required. If an offline record arrives without age and shows fever, the result is at least `SEE_DOCTOR_24H`.
- Triage without an account uses exactly the same rules and model, works offline, and stores nothing on the server.
- Rule definitions live in a single shared source ([`shared/`](shared/README.md)). The TypeScript and Python engines must both pass the same golden test cases, so the offline and online paths cannot drift apart.
