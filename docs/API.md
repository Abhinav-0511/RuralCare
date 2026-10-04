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

## AI service contract (`POST {AI_SERVICE_URL}/predict`, implemented in Phase 3)

```jsonc
// request: TriageContext
{ "symptoms": ["cough", "mild_fever"], "ageMonths": 420, "sex": "female", "pregnant": false, "temperatureC": 38.1 }
// response
{ "level": "SELF_CARE", "confidence": 0.82, "modelVersion": "rf-2026-10-01",
  "topConditions": [{ "id": "common_cold", "probability": 0.82 }] }
```

`level` must be `SEE_DOCTOR_24H`, `SEE_DOCTOR_SOON` or `SELF_CARE`. Anything else, an HTTP error, or a 5 s timeout makes the server use the rules-only fallback.

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
