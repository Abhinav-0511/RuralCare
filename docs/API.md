# RuralCare API

The OpenAPI 3.1 spec is generated from the same Zod schemas that validate requests, so it can't drift from the code.

- **Swagger UI:** http://localhost:4000/api/docs
- **Raw spec:** http://localhost:4000/api/openapi.json

All endpoints except `/health`, `GET /api/villages`, register, login and refresh need `Authorization: Bearer <accessToken>`.

## Endpoints and roles

| Method         | Path                                              |              patient              | health_worker | doctor | admin |
| -------------- | ------------------------------------------------- | :-------------------------------: | :-----------: | :----: | :---: |
| POST           | `/api/auth/register`                              | public: creates a patient account |               |        |       |
| POST           | `/api/auth/login`, `/api/auth/refresh`            |              public               |               |        |       |
| POST           | `/api/auth/logout` · GET `/api/auth/me`           |                 ✓                 |       ✓       |   ✓    |   ✓   |
| GET            | `/api/villages`                                   |              public               |               |        |       |
| POST           | `/api/villages`                                   |                                   |               |        |   ✓   |
| GET/POST/PATCH | `/api/users`                                      |                                   |               |        |   ✓   |
| GET            | `/api/patients`                                   |                                   | own villages  |   ✓    |   ✓   |
| POST           | `/api/patients`                                   |                                   | own villages  |        |   ✓   |
| GET            | `/api/patients/:id`                               |               self                | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage`                                     |               self                | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage/sync`                                |               self                | own villages  |   ✓    |   ✓   |
| GET            | `/api/triage`, `/api/triage/:id`                  |               self                | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage/:id/notes`, `/api/triage/:id/review` |                                   |               |   ✓    |       |
| GET            | `/api/dashboard/stats`                            |                                   | own villages  |   ✓    |   ✓   |

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

Common codes: `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_ID`, `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `NOT_FOUND`, `PHONE_TAKEN`, `UNKNOWN_VILLAGE`, `UNKNOWN_SYMPTOMS`, `PATIENT_REQUIRED`, `CLIENT_ID_CONFLICT`, `ALREADY_REVIEWED`, `INVALID_RANGE`, `RANGE_TOO_LARGE`.
