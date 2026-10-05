# RuralCare: safety design and decisions

RuralCare gives **triage guidance, not a diagnosis**. Every result screen and API response carries a disclaimer in English, Tamil and Hindi (`guidance.disclaimer`).

This document records the safety rules and the deliberate trade-offs behind them. Rule definitions live in [`shared/data/red_flags.json`](../shared/data/red_flags.json). Their exact semantics are pinned by golden test cases that both the TypeScript and Python engines must pass ([`shared/tests/red_flag_cases.json`](../shared/tests/red_flag_cases.json)).

## 1. How a result is decided

```
input ──► red-flag rules ──match──► EMERGENCY (model NOT called)
               │
           no match
               ▼
          ML model ──ok──► model level ─┐
               │                        ├─► raised to the safety floor, if one matched
          unavailable ──► SEE_DOCTOR_SOON ┘    (result.source = rule_engine_fallback)
```

| Mechanism                      | What it can do                                                                                                                                           | Where                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Red-flag rules**             | Force `EMERGENCY`. Only rules can produce `EMERGENCY`.                                                                                                   | `rules` in `red_flags.json`                |
| **Safety floors**              | Set a _minimum_ level (never `EMERGENCY`). The model cannot go below it.                                                                                 | `floors` in `red_flags.json`               |
| **Model-unavailable fallback** | When the AI service is down, slow (5 s timeout) or returns anything invalid, the result is `SEE_DOCTOR_SOON` with a notice. It is **never `SELF_CARE`**. | `modelUnavailable` in `triage_levels.json` |
| **Model output guard**         | A model response claiming `EMERGENCY`, or any malformed response, is treated as "unavailable".                                                           | `server/src/services/aiClient.ts`          |

The same `decideTriage()` function ([`shared/src/triage.ts`](../shared/src/triage.ts)) combines these online (server) and, from Phase 5, offline (browser). The two paths reach the same decision.

## 2. Red flags (always EMERGENCY)

Chest pain · difficulty breathing · unconscious / not responding (incl. the dataset's `coma`) · sudden confusion or unusual drowsiness · severe bleeding, vomiting blood or stomach bleeding · coughing up blood · stroke signs (face drooping, one-sided weakness, slurred speech) · seizure · fever in a baby under 3 months (any fever or ≥ 38 °C) · high fever in a baby under 1 year (high fever or ≥ 39 °C) · bleeding during pregnancy.

**Critical vital signs** (from a device or typed in): SpO₂ < 90% · heart rate ≥ 150 or < 40 (age ≥ 12 years or unknown), ≥ 200 or < 60 (under 12) · systolic BP ≥ 180 or diastolic ≥ 120 (any age) · systolic < 80 (age ≥ 12 or unknown), < 70 (under 12) · temperature ≥ 41 °C.

## 3. Deliberate trade-offs

### 3.1 "Difficulty breathing" is always an EMERGENCY (safety over accuracy)

The `breathlessness` symptom is also a feature in the training dataset. It appears in asthma, pneumonia and other conditions that are not always emergencies. Because of this rule, every patient who ticks it gets `EMERGENCY`, including someone with mild, familiar asthma.

**We accept this over-triage on purpose.** In the rural setting RuralCare targets, the nearest doctor may be hours away. Missing a real breathing emergency (severe asthma attack, pneumonia with low oxygen, heart failure, anaphylaxis) is far more costly than an unnecessary trip. The error is in the safe direction.

**Cost:** some unnecessary emergency referrals, and the model never gets to classify breathing-related cases. The model report (Phase 3) will state that these cases are outside the model's scope.

### 3.2 Age is required, with a safety floor if it is still missing

Age changes the meaning of many symptoms. Fever is the clearest example: it is routine in an adult and an emergency in a newborn.

- **New triage (app form and `POST /api/triage`):** `ageMonths` is **required**. A request without it is rejected with `400`.
- **Offline records being synced (`POST /api/triage/sync`):** age is optional. A record made offline must never be dropped, because it may describe an emergency.
- **Safety floor `FLOOR_FEVER_AGE_UNKNOWN`:** if age is missing **and** there is fever (`mild_fever`, `high_fever`, or a measured temperature ≥ 38 °C), the result is **at least `SEE_DOCTOR_24H`**. This holds whether the model says `SELF_CARE` or the model is unavailable.
  - Reason: with an unknown age we cannot rule out an infant, for whom fever is a red flag.
  - Covered by golden cases (both engines) and server tests (`server/test/triage.test.ts`).

### 3.3 Pregnancy bleeding depends on the pregnancy question being answered

`RF_PREGNANCY_BLEEDING` fires only when `pregnant = true`. Vaginal bleeding without pregnancy (for example, menstruation) is not an emergency on its own. "Severe bleeding" is a red flag for everyone, regardless of pregnancy.

This makes the rule depend on the user actually answering the pregnancy question, which leads to the next requirement.

### 3.4 Duration and severity floors (Phase 5)

The triage input has two optional fields, `durationDays` and `severity` (`mild`, `moderate`, `severe`), asked by the PWA wizard. Two safety floors use them:

| Floor                   | When                | Minimum level     | Why                                                                                                                         |
| ----------------------- | ------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `FLOOR_SEVERE_SYMPTOMS` | `severity = severe` | `SEE_DOCTOR_24H`  | The model only sees which symptoms are present, not how bad they are. A patient who says "severe" should not get home care. |
| `FLOOR_LONG_DURATION`   | `durationDays ≥ 14` | `SEE_DOCTOR_SOON` | Symptoms lasting two weeks or more (e.g. a long cough) need a doctor even when each symptom looks mild.                     |

Both are in `floors` in `red_flags.json`, are evaluated by both engines (conditions `severityIn` and `durationDaysGte`), and are covered by golden cases. Missing values never trigger them.

### 3.5 What the model may and may not decide (Phase 3)

- **The model never decides EMERGENCY.** Even "heart attack" or "brain haemorrhage" map to `SEE_DOCTOR_24H` at most. Emergencies come only from the red-flag rules, which run first.
- **Low confidence never gives SELF_CARE.** If the top condition's probability is below 0.6, the result is at least `SEE_DOCTOR_SOON`. The same applies if the patient reports a symptom the model has no feature for (e.g. vaginal bleeding without pregnancy), or no symptom the model knows at all.
- **A serious runner-up raises the level.** If a more urgent condition is in the top 3 with probability ≥ 0.25, its level is used.
- **Dataset synonyms of red flags are red flags.** The dataset's `coma` counts as _unconscious_, and its `stomach_bleeding` counts as _severe bleeding_.
- **Accuracy is measured honestly.** Results include a noisy test set and the under-triage rate. See [MODEL_REPORT.md](MODEL_REPORT.md), including why the confidence threshold only became meaningful after tuning the model's regularisation.

### 3.6 Vital signs (Phase 4, revised in Phase 5)

- **Alerts and red flags are aligned.** Device readings raise _warning_ alerts (e.g. SpO₂ < 92, temperature ≥ 39.5 °C) and _critical_ alerts (e.g. SpO₂ < 90). Every critical alert threshold also matches a red-flag rule, so a triage that includes those vitals is EMERGENCY. A test (`shared/src/vitals.test.ts`) enforces this; warning thresholds alone never make triage an emergency.
- **Recent vitals join triage automatically.** When a triage has no typed-in vitals, the server attaches the patient's device readings from the last 30 minutes (for synced offline sessions, the 30 minutes before the session was recorded).
- **The worst reading counts, not just the latest.** For each vital, triage uses the _most abnormal_ reading in the window (by alert severity), otherwise the latest. Without this, a brief SpO₂ 86 followed by normal readings would be invisible to triage, even though it raised a critical alert. This was found in the end-to-end test. Trade-off: a single sensor glitch can over-triage, which is the safe direction.
- **Typed-in and device vitals: the worse value wins.** For each vital (temperature included), triage uses whichever of the typed-in value and the device value is more abnormal ([`server/src/vitals/recent.ts`](../server/src/vitals/recent.ts)). The session records `vitalsSource`: `manual`, `device` or `combined`. Earlier, typed-in values replaced device values; that could hide a critical device reading behind a normal manual one. Trade-off: a faulty device can over-triage, which is the safe direction. Tests: `server/test/triageVitals.test.ts`.
- **Device data never blocks triage:** if TimescaleDB is down, triage continues without device vitals.
- **The same rules apply offline:** vitals are part of the shared triage input, so the PWA (Phase 5) applies the same thresholds to vitals entered on the device.
- **Alert thresholds are age-aware**, using the same 12-year band as the red-flag rules ([`shared/data/vitals.json`](../shared/data/vitals.json)). Children (under 12): heart rate warning ≥ 180, critical ≥ 200 or < 60, systolic critical < 70. Adults (and unknown age): heart rate warning ≥ 120 or < 50, critical ≥ 150 or < 40, systolic critical < 80.
  - **Fallback:** a threshold without an age band (SpO₂, temperature, high blood pressure) applies to every age, at the adult value, because no child value is defined.
  - **Unknown age uses the adult band**, like the red-flag rules.
  - A red-flag rule for child systolic < 70 keeps "every critical alert is also a red flag" true in both bands; a test checks every band.
  - None of these thresholds are clinically validated.

## 4. Requirements for the Phase 5 app

All done in Phase 5 and covered by client tests (`TriageWizard.test.tsx`, `offline.test.ts`) and the Playwright e2e suite.

- [x] **Age is a required field** on every triage form. Accept years or months for babies, and store `ageMonths`.
- [x] **Always show "Are you pregnant?"** when sex is female and age is 12–50 years. Don't hide it behind an optional checkbox. Answers: Yes / No / Not sure. Treat "Not sure" as _not confirmed_, but show bleeding advice prominently. (The advice appears under the question as soon as "Not sure" is chosen.)
- [x] The **disclaimer** is visible on every result screen, in the selected language.
- [x] When `result.source = rule_engine_fallback`, show `guidance.notice` (the model was unavailable).
- [x] The offline path uses the same shared rules, floors and `decideTriage()`.
- [x] EMERGENCY results show a large **Call 108** link (`tel:108`).

## 5. Known limitations

- Thresholds follow common public guidance (for example, WHO IMCI-style danger signs) and are **not clinically validated**.
- **The condition-to-triage table (`shared/data/conditions.json`) is not clinically validated and must be reviewed by a doctor before any real use.** It records which of the 41 model conditions map to SEE_DOCTOR_24H, SEE_DOCTOR_SOON or SELF_CARE, and is the developer's judgement for this student project.
- Known model confusion: dengue-like symptoms with a skin rash are pulled towards impetigo (dengue 0.40, impetigo 0.36). The policy still returns SEE_DOCTOR_24H; see [MODEL_REPORT.md](MODEL_REPORT.md) §11.
- Symptom input is a checklist. Overall severity and duration are asked (§3.4), but not per symptom: "difficulty breathing" doesn't distinguish mild from severe, so it stays a red flag.
- **Offline triage can't see device vitals.** The server adds them when the session syncs, and the app tells the user if the server's result differs ([PWA.md](PWA.md)).
- Demo data (`npm run seed`) is triaged by the real rules and the real model (since Phase 3).

## 6. Onboarding: guest triage and accounts

### 6.1 Guest triage gives the same safety, and stores nothing

Anyone can check symptoms without an account ("Check symptoms without an account" on the login screen). This must never be a weaker path:

- **Same engine.** The guest wizard is the normal wizard. Online, `POST /api/guest/triage` calls the same `evaluateTriage()` as `/api/triage`; offline, the device runs the same `runLocalTriage()`. Red flags give EMERGENCY with the Call 108 button, safety floors apply, the disclaimer is shown, and a model outage falls back to rules-only (never SELF_CARE). Tests: `server/test/guest.test.ts` (same level, source and floors as a staff triage) and `client/src/triage/guest.test.ts` (red flag offline without a model).
- **Age is required** for guests too.
- **Always an answer.** If the guest endpoint is rate-limited (`429`), down (`5xx`) or unreachable, the phone decides on its own with the same rules. A rate limit can never block an emergency result.
- **Nothing on the server.** The endpoint writes nothing (a test compares every collection before and after) and answers `Cache-Control: no-store`. The result is kept only in the phone's IndexedDB (`guestChecks`), outside the sync outbox, and is marked **"Not saved to a health record"** on screen.
- **Trade-off:** a guest check can't use device vitals (there is no patient to link them to), and no doctor will review it. The result screen tells the guest to ask their village health worker to register them.

### 6.2 Adding guest checks to a record

When a patient logs in for the first time on a phone with guest checks, the app asks _"You have N earlier checks on this phone. Add them to your record?"_ and lists their dates and levels. **Phones are often shared in a family**, so this is a question, not automatic, and the hint says to add them only if they were about this person. Added checks are re-evaluated by the server like any offline sync (the server's verdict wins and differences are shown) and stored with `origin: "guest"`, so a doctor can see they were entered without a known patient. If the patient says no, the checks stay on the phone and the question is not asked again for that user on that phone.

### 6.3 Who can create accounts

- **No self sign-up.** No public endpoint can create an account; `POST /api/auth/register` returns `410`. A test posts a would-be account to every unauthenticated endpoint and checks that no user appears.
- **Patients are registered by their health worker,** and only in the health worker's own villages. The patient login's role is fixed to `patient` by the server.
- **Roles are set only by an admin** (`/api/users`, admin-only). Patient accounts can't be turned into staff accounts.
- **Duplicate patients:** registering a phone number that another patient already has gives a warning (`DUPLICATE_PHONE`). The health worker can still register a different person with the same number (a shared family phone is common). A phone number can belong to only one login.

### 6.4 Passwords

- **Temporary passwords** (created by a health worker or admin) are shown once and stored only as a bcrypt hash. Until the user picks their own password, every endpoint except change-password, `/me` and logout answers `403 PASSWORD_CHANGE_REQUIRED`, and the app shows only the change-password screen.
- **Resets revoke sessions.** A health worker or admin reset, a self-service OTP reset and a password change all bump the user's token version, so every existing access and refresh token stops working at once.
- **Forgot password by SMS code:** 6 digits, valid 5 minutes, single use, at most 5 wrong tries per code, 3 codes per phone per hour, and a per-IP limit. Only an HMAC of the code is stored.
- **No phone-number enumeration.** The request endpoint gives the same answer (and the same rate limit) for numbers with and without an account. Records are kept for unknown numbers too. In development, a code is echoed for every number, and it only works for real accounts. Every confirm failure is the same `INVALID_OTP`. Login already answered wrong-password and unknown-phone identically.
- **SMS is mocked** (the server logs the code). Echoing the code in the API response (`OTP_DEV_ECHO`) is refused in production.
- **Without access to their phone,** a patient asks their health worker for a reset, and staff ask an admin.

### 6.5 Known limitations

- Rate limits are kept in memory in one server process. Several replicas (Phase 6, Kubernetes) need a shared store such as Redis.
- Temporary passwords are handed over in person. Nothing enforces how the health worker passes them on.
- A guest check on a shared phone could be added to the wrong person's record if they answer "yes" carelessly. The list of dates and levels in the question, and the `guest` origin seen by doctors, reduce this but cannot prevent it.
