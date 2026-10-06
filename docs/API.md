# RuralCare API

The OpenAPI 3.1 spec is generated from the same Zod schemas that validate requests, so it can't drift from the code.

- **Swagger UI:** http://localhost:4000/api/docs
- **Raw spec:** http://localhost:4000/api/openapi.json

All endpoints except `/health`, `GET /api/villages`, login, refresh, the password-reset pair and `POST /api/guest/triage` need `Authorization: Bearer <accessToken>`. **No public endpoint creates an account.**

## Endpoints and roles

| Method         | Path                                                      |               patient                | health_worker | doctor | admin |
| -------------- | --------------------------------------------------------- | :----------------------------------: | :-----------: | :----: | :---: |
| POST           | `/api/auth/register`                                      |   disabled: `410`, creates nothing   |               |        |       |
| POST           | `/api/auth/password-reset/request`, `/confirm`            |         public, rate-limited         |               |        |       |
| POST           | `/api/guest/triage`                                       | public, rate-limited, stores nothing |               |        |       |
| POST           | `/api/auth/login`, `/api/auth/refresh`                    |                public                |               |        |       |
| POST           | `/api/auth/logout` · GET `/api/auth/me`                   |                  ✓                   |       ✓       |   ✓    |   ✓   |
| POST           | `/api/auth/change-password`                               |                  ✓                   |       ✓       |   ✓    |   ✓   |
| GET            | `/api/villages` (`?active=true`: only active)             |                public                |               |        |       |
| POST · PATCH   | `/api/villages`, `/api/villages/:id`                      |                                      |               |        |   ✓   |
| GET/POST/PATCH | `/api/users`                                              |                                      |               |        |   ✓   |
| POST           | `/api/users/:id/reset-password` (staff)                   |                                      |               |        |   ✓   |
| GET            | `/api/patients`                                           |                                      | own villages  |   ✓    |   ✓   |
| POST           | `/api/patients`                                           |                                      | own villages  |        |   ✓   |
| POST           | `/api/patients/:id/login` (login for an existing patient) |                                      | own villages  |        |   ✓   |
| POST           | `/api/patients/:id/reset-password`                        |                                      | own villages  |        |   ✓   |
| GET            | `/api/patients/:id`                                       |                 self                 | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage`                                             |                 self                 | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage/sync`                                        |                 self                 | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage/guest-claims`                                |                 self                 |               |        |       |
| GET            | `/api/triage`, `/api/triage/:id`                          |                 self                 | own villages  |   ✓    |   ✓   |
| POST           | `/api/triage/:id/notes`, `/api/triage/:id/review`         |                                      |               |   ✓    |       |
| GET            | `/api/dashboard/stats`                                    |                                      | own villages  |   ✓    |   ✓   |
| GET            | `/api/vitals/:patientId`, `/api/vitals/:patientId/latest` |                 self                 | own villages  |   ✓    |   ✓   |
| GET            | `/api/alerts`                                             |                 self                 | own villages  |   ✓    |   ✓   |
| PATCH          | `/api/alerts/:id` (acknowledge)                           |                                      | own villages  |   ✓    |       |
| GET            | `/api/model/version`                                      |                public                |               |        |       |

## Onboarding and accounts

There is no self sign-up. Patient logins are created by a health worker, staff logins by an admin, and a role can only ever be set by an admin (`/api/users`). `POST /api/auth/register` answers `410 SELF_REGISTRATION_DISABLED`.

### Temporary passwords

A login created by a health worker or admin without a password gets a **temporary password**, returned **once** in the response (stored only as a bcrypt hash). The user then has `mustChangePassword: true`, and every authenticated endpoint except `GET /api/auth/me`, `POST /api/auth/logout` and `POST /api/auth/change-password` answers `403 PASSWORD_CHANGE_REQUIRED`.

```jsonc
// POST /api/auth/change-password   (Bearer token of the temporary session)
{ "currentPassword": "Hk7mQ2pZx9", "newPassword": "my-own-secret" }
// 200 → { "user": { …, "mustChangePassword": false }, "tokens": { … } }   other sessions are revoked
```

### Health worker: register a patient (`POST /api/patients`)

New optional fields (existing requests keep working): `createLogin`, `preferredLanguage`, `allowDuplicatePhone`.

```jsonc
// request (health worker; villageId must be one of their villages, otherwise 403)
{ "name": "Kaveri N", "sex": "female", "dateOfBirth": "1995-03-10", "villageId": "…",
  "phone": "9876543210", "createLogin": true, "preferredLanguage": "ta" }
// 201 → the patient, plus (only with createLogin):
{ "userId": "…", "login": { "phone": "9876543210", "temporaryPassword": "Hk7mQ2pZx9" } }
```

| Error                  | When                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `409 DUPLICATE_PHONE`  | Another patient has this phone. A warning: repeat with `allowDuplicatePhone: true` (e.g. a shared family phone). |
| `409 PHONE_TAKEN`      | `createLogin` with a phone that already has a login.                                                             |
| `400 VALIDATION_ERROR` | `createLogin` without a phone.                                                                                   |

**A login for a patient registered earlier without one:** `POST /api/patients/:id/login` (health worker of that village, or admin), body `{ "phone"?: "…", "preferredLanguage"?: "ta" }`. It uses the phone on the record, or saves `phone` on the record if it has none. It returns `201 { phone, temporaryPassword }` with the same rules as registration (shown once, must be changed at first login). Errors: `409 LOGIN_EXISTS` (reset the password instead), `409 PHONE_TAKEN`, `400 PHONE_REQUIRED`, `400 PHONE_MISMATCH` (a different phone than the record's).

The login's role is always `patient`; any `role` in the body is ignored. `POST /api/patients/:id/reset-password` (health worker of that village, or admin) returns `{ phone, temporaryPassword }`, sets `mustChangePassword` and signs the patient out everywhere (`400 NO_LOGIN` if the patient has no login).

### Admin

- `POST /api/users`: `password` is now optional. Without it a temporary password is generated and returned once as `temporaryPassword`.
- `PATCH /api/users/:id` also accepts `preferredLanguage`. Changing the role or deactivating revokes the user's tokens (as before).
- `POST /api/users/:id/reset-password`: staff only (`400 USE_PATIENT_RESET` for patients).
- `PATCH /api/villages/:id`: `name`, `district`, `state`, `location`, `isActive`.

### Deactivating a village (instead of deleting it)

`PATCH /api/villages/:id { "isActive": false }` (admin). A deactivated village:

- is refused for new patients (`400 VILLAGE_INACTIVE` on `POST /api/patients`) and for new staff assignments (`400 VILLAGE_INACTIVE` on `/api/users`, including reactivating a staff member who is assigned to it);
- keeps its patients, sessions, alerts and vitals, which stay visible and usable;
- is still listed by `GET /api/villages` (with `isActive: false`); `GET /api/villages?active=true` leaves it out (used by the registration form).

Deactivation is refused with `409 VILLAGE_HAS_STAFF` while **active** staff are assigned. The message names them, and `error.details.staff` lists `{ id, name }`. Move them to another village (or deactivate them) first. `{ "isActive": true }` reactivates. Villages created before this field existed count as active.

### Forgot password (SMS code)

```jsonc
// 1. POST /api/auth/password-reset/request   { "phone": "9000000021" }
// 202, identical for every phone number, whether or not it has an account:
{
  "message": "If this number has an account, a code has been sent to it.",
  "expiresInSeconds": 300,
  "devOtp": "482913",
} // only with OTP_DEV_ECHO (development); present for unknown numbers too
// 2. POST /api/auth/password-reset/confirm   { "phone": "9000000021", "otp": "482913", "newPassword": "…" }
// 200 → { "message": "Password changed. …" }   all sessions of the user are revoked
```

| Rule                    | Default                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Code                    | 6 digits, stored only as an HMAC, single use; a new request replaces the previous code   |
| Expiry                  | `OTP_TTL_SECONDS` = 300                                                                  |
| Wrong attempts per code | `OTP_MAX_ATTEMPTS` = 5, then the code no longer works                                    |
| Requests per phone      | `OTP_REQUESTS_PER_PHONE_PER_HOUR` = 3 (`429`), counted for unknown numbers too           |
| Requests per IP         | `AUTH_RATE_LIMIT_PER_15MIN` = 20 across both endpoints (`429`, `Retry-After`)            |
| Errors                  | Wrong, expired, used, out-of-attempts and unknown-phone codes all give `400 INVALID_OTP` |

SMS goes through `SmsSender` (`server/src/services/sms.ts`). The only provider is `SMS_PROVIDER=console`, which logs the message with a masked phone number. A real gateway implements the same one-method interface. The send is not awaited, so a slow gateway can't make answers for real accounts measurably slower.

### Guest triage (`POST /api/guest/triage`, public)

```jsonc
// request: same input as POST /api/triage (age required)
{ "input": { "symptoms": ["chest_pain"], "ageMonths": 360, "sex": "female" } }
// 200
{ "result": { "level": "EMERGENCY", "source": "rule_engine", "redFlags": ["…"], … },
  "guidance": { … }, "stored": false }
```

Same rules, safety floors, model and fallback as `/api/triage`, but **nothing is written** to any database (a test compares every collection before and after) and the response has `Cache-Control: no-store`. Rate limit: `GUEST_TRIAGE_RATE_LIMIT_PER_10MIN` = 30 per IP. The PWA falls back to on-device triage on `429`, `5xx` or no network, so a guest always gets an answer.

### Adding guest checks to a record (`POST /api/triage/guest-claims`, patient)

Body: `{ "sessions": [ { clientId, clientCreatedAt, input, clientResult? } ] }`, like a sync item without `patientId` (the caller's own record is always used). Each check is re-evaluated exactly like `/api/triage/sync`, stored with **`origin: "guest"`**, and idempotent per `clientId`. The response has the same shape as `/api/triage/sync`.

### Rate limits

The limits are in memory, per server process. That is enough for one instance; several replicas (Phase 6) need a shared store such as Redis.

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

Common codes: `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_ID`, `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `NOT_FOUND`, `PHONE_TAKEN`, `UNKNOWN_VILLAGE`, `UNKNOWN_SYMPTOMS`, `PATIENT_REQUIRED`, `CLIENT_ID_CONFLICT`, `ALREADY_REVIEWED`, `INVALID_RANGE`, `RANGE_TOO_LARGE`, `TOO_MANY_POINTS`, `VITALS_UNAVAILABLE`, `ALREADY_ACKNOWLEDGED`, `MODEL_UNAVAILABLE`, `SELF_REGISTRATION_DISABLED`, `PASSWORD_CHANGE_REQUIRED`, `DUPLICATE_PHONE`, `NO_LOGIN`, `USE_PATIENT_RESET`, `INVALID_OTP`, `RATE_LIMITED`, `LOGIN_EXISTS`, `PHONE_REQUIRED`, `PHONE_MISMATCH`, `VILLAGE_INACTIVE`, `VILLAGE_HAS_STAFF`.
