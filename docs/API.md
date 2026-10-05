# RuralCare API

The OpenAPI 3.1 spec is generated from the same Zod schemas that validate requests, so it can't drift from the code.

- **Swagger UI:** http://localhost:4000/api/docs
- **Raw spec:** http://localhost:4000/api/openapi.json

All endpoints except `/health`, `GET /api/villages`, register, login and refresh need `Authorization: Bearer <accessToken>`.

## Endpoints and roles

| Method         | Path                                                      |              patient              | health_worker | doctor | admin |
| -------------- | --------------------------------------------------------- | :-------------------------------: | :-----------: | :----: | :---: |
| POST           | `/api/auth/register`                                      | public: creates a patient account |               |        |       |
| POST           | `/api/auth/login`, `/api/auth/refresh`                    |              public               |               |        |       |
| POST           | `/api/auth/logout` · GET `/api/auth/me`                   |                 ✓                 |       ✓       |   ✓    |   ✓   |
| GET            | `/api/villages`                                           |              public               |               |        |       |
| POST           | `/api/villages`                                           |                                   |               |        |   ✓   |
| GET/POST/PATCH | `/api/users`                                              |                                   |               |        |   ✓   |
| GET            | `/api/patients`                                           |                                   | own villages  |   ✓    |   ✓   |
| POST           | `/api/patients`                                           |                                   | own villages  |        |   ✓   |
| GET            | `/api/patients/:id`                                       |               self                | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage`                                             |               self                | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage/sync`                                        |               self                | own villages  |   ✓    |   ✓   |
| GET            | `/api/triage`, `/api/triage/:id`                          |               self                | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage/:id/notes`, `/api/triage/:id/review`         |                                   |               |   ✓    |       |
| GET            | `/api/dashboard/stats`                                    |                                   | own villages  |   ✓    |   ✓   |
| GET            | `/api/vitals/:patientId`, `/api/vitals/:patientId/latest` |               self                | own villages  |   ✓    |   ✓   |
| GET            | `/api/alerts`                                             |               self                | own villages  |   ✓    |   ✓   |
| PATCH          | `/api/alerts/:id` (acknowledge)                           |                                   | own villages  |   ✓    |       |
| GET            | `/api/model/version`                                      |              public               |               |        |       |

## Triage input (Phase 5 fields)

`input` in `POST /api/triage` and `POST /api/triage/sync` is the shared `TriageContext`. Phase 5 added two optional fields:

| Field          | Type                                   | Used by                                                             |
| -------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `durationDays` | integer 0–3650                         | Floor `FLOOR_LONG_DURATION`: ≥ 14 days ⇒ at least `SEE_DOCTOR_SOON` |
| `severity`     | `"mild"` \| `"moderate"` \| `"severe"` | Floor `FLOOR_SEVERE_SYMPTOMS`: `severe` ⇒ at least `SEE_DOCTOR_24H` |

```jsonc
{
  "symptoms": ["cough", "mild_fever"],
  "ageMonths": 420,
  "sex": "female",
  "durationDays": 21,
  "severity": "moderate",
  "temperatureC": 38.2, // optional, typed in
  "vitals": { "spo2": 96, "heartRate": 88 }, // optional, typed in
}
```

## Listing triage sessions (`GET /api/triage`)

- `sort=recent` (default): newest first.
- `sort=urgency`: `EMERGENCY` first, then by level, newest first within a level. The doctor's review queue uses this.
- Every item in the list includes `patientName` (`null` if the patient can't be found).

## Vitals in a session (`vitalsSource`)

A stored session records where the vitals used for triage came from:

| `vitalsSource` | Meaning                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------ |
| `manual`       | Only typed-in vitals.                                                                      |
| `device`       | Only device readings from the last 30 min.                                                 |
| `combined`     | Both. For each vital the **more abnormal** of the two values is used (see SAFETY.md §3.6). |
| `null`         | No vitals.                                                                                 |

## Triage response

```jsonc
{
  "session": {
    "id": "…",
    "clientId": "…",
    "result": {
      "level": "SEE_DOCTOR_SOON",
      "source": "rule_engine_fallback", // rule_engine | model | rule_engine_fallback
      "redFlags": [],
      "safetyFloors": [],
      "model": { "status": "unavailable", "reason": "AI service unreachable" },
    },
    "review": { "status": "pending", "notes": [] },
  },
  "guidance": {
    "title": { "en": "See a doctor in the next few days", "ta": "…", "hi": "…" },
    "advice": { "en": "…", "ta": "…", "hi": "…" },
    "disclaimer": { "en": "This is triage guidance, not a medical diagnosis…", "ta": "…", "hi": "…" },
    "notice": { "en": "The automatic assessment is unavailable right now…" }, // only for the fallback
    "reasons": [], // labels of matched red flags / safety floors
  },
  "duplicate": false,
}
```

## Idempotency

Both `POST /api/triage` (optional `clientId`) and `POST /api/triage/sync` (required `clientId`) are idempotent. A unique index on `clientId` enforces this:

- **Same `clientId` sent again:** returns the original session (`duplicate: true` / `"status": "duplicate"`). The request is not re-evaluated.
- **Simultaneous retries:** create exactly one session.
- **`clientId` already used for a different patient:** rejected with `CLIENT_ID_CONFLICT`.

## Model version (`GET /api/model/version`, public)

The server proxies this from the AI service. The PWA compares `sha256` with its cached `/models/triage_model.onnx` (served by the client) to decide whether to download a new model. If the model is unavailable, the response is `503 MODEL_UNAVAILABLE`.

```json
{
  "modelVersion": "lr-20261004-ab911d5e",
  "algorithm": "Logistic Regression (C=10000)",
  "createdAt": "…",
  "sha256": "ab911d5e…",
  "sizeBytes": 27607,
  "featureCount": 131,
  "classCount": 41
}
```

## AI service contract (`POST {AI_SERVICE_URL}/predict`)

```jsonc
// request: TriageContext
{ "symptoms": ["runny_nose", "congestion", "cough"], "ageMonths": 420, "sex": "female" }
// response
{
  "level": "SELF_CARE", "source": "model", "confidence": 0.7, "lowConfidence": false,
  "modelVersion": "lr-20261004-ab911d5e", "rulesVersion": "1.2.0",
  "topConditions": [
    { "id": "common_cold", "probability": 0.7, "triageLevel": "SELF_CARE",
      "name": { "en": "Common cold", "ta": "ஜலதோஷம்", "hi": "सामान्य सर्दी-ज़ुकाम" },
      "advice": { "en": "Rest and drink warm fluids…", "ta": "…", "hi": "…" } }
    // … top 3
  ],
  "advice": { "en": "Rest, drink plenty of clean water…", "ta": "…", "hi": "…" },
  "disclaimer": { "en": "This is triage guidance, not a medical diagnosis…", "ta": "…", "hi": "…" },
  "redFlags": [], "safetyFloors": [], "unmodelledSymptoms": []
}
```

- **Red flags are re-checked by the AI service first.** If one matches, the service returns `level: "EMERGENCY"`, `source: "rule_engine"` and the matched `redFlags`, and the server accepts that as EMERGENCY. An EMERGENCY _without_ red flags is rejected as invalid, because the model itself can never say EMERGENCY.
- **The level comes from the shared policy** in `shared/data/conditions.json`. Below 0.6 confidence, or with a symptom the model can't see, the level is at least `SEE_DOCTOR_SOON`. A serious runner-up can raise the level. Safety floors also apply.
- **When the server falls back to rules only:** an HTTP error, an invalid payload, a 5 s timeout, or `503` (no model loaded).
- **Condition names and advice** come from `/shared`. The server rebuilds them for `guidance.possibleConditions`, and the offline PWA uses the same texts.

## Vitals and alerts (Phase 4)

**Device → broker (MQTT 5, QoS 1).** Topic `ruralcare/vitals/{patientId}/{deviceId}`, payload:

```json
{
  "ts": "2026-10-05T09:30:00.000Z",
  "heartRate": 76,
  "spo2": 97,
  "temperatureC": 36.8,
  "systolicBp": 122,
  "diastolicBp": 80
}
```

- **Validation:** any subset of vitals is allowed. Implausible values (e.g. SpO₂ > 100), unknown fields and timestamps more than 5 min in the future are rejected. A redelivered message (same device and timestamp) is stored once.
- **Authentication:** every client needs a username and password. The ACL lets each device only _write_ its own patient's topic; the broker answers PUBACK reason 135 otherwise. The server account may only _read_. The server additionally checks that the device is registered to that patient.

**`GET /api/vitals/:patientId?from&to&bucket`** returns `time_bucket()` averages plus min SpO₂ / max heart rate / max temperature and a reading count per bucket:

- `bucket` is `1m`, `5m`, `15m`, `1h` or `1d`; by default it is chosen from the range.
- `1h` and `1d` read the `vitals_hourly` continuous aggregate.
- The response may hold at most 2,000 points.

**`GET /api/vitals/:patientId/latest?windowMinutes=30`** returns the newest value of each vital and the alerts those values raise.

**`GET /api/alerts?acknowledged=false&severity=critical`** lists alerts in scope, with `patientName` and an en/ta/hi `label`. There is one open alert per patient and threshold code; repeat breaches update `value`, `lastSeenAt` and `count`.

**`PATCH /api/alerts/:id`** with `{ "acknowledged": true, "note": "Visited, sent to PHC" }` acknowledges an alert. Only health workers of that village and doctors can do this, and only once (`409 ALREADY_ACKNOWLEDGED`). A later breach opens a new alert.

## Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "input.ageMonths", "message": "…" }]
  }
}
```

Common codes: `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_ID`, `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `NOT_FOUND`, `PHONE_TAKEN`, `UNKNOWN_VILLAGE`, `UNKNOWN_SYMPTOMS`, `PATIENT_REQUIRED`, `CLIENT_ID_CONFLICT`, `ALREADY_REVIEWED`, `INVALID_RANGE`, `RANGE_TOO_LARGE`, `TOO_MANY_POINTS`, `VITALS_UNAVAILABLE`, `ALREADY_ACKNOWLEDGED`, `MODEL_UNAVAILABLE`.
