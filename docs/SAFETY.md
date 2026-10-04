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

Chest pain · difficulty breathing · unconscious / not responding · severe bleeding or vomiting blood · stroke signs (face drooping, one-sided weakness, slurred speech) · seizure · fever in a baby under 3 months (any fever or ≥ 38 °C) · high fever in a baby under 1 year (high fever or ≥ 39 °C) · bleeding during pregnancy.

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

## 4. Requirements for the Phase 5 app

- [ ] **Age is a required field** on every triage form. Accept years or months for babies, and store `ageMonths`.
- [ ] **Always show "Are you pregnant?"** when sex is female and age is 12–50 years. Don't hide it behind an optional checkbox. Answers: Yes / No / Not sure. Treat "Not sure" as _not confirmed_, but show bleeding advice prominently.
- [ ] The **disclaimer** is visible on every result screen, in the selected language.
- [ ] When `result.source = rule_engine_fallback`, show `guidance.notice` (the model was unavailable).
- [ ] The offline path uses the same shared rules, floors and `decideTriage()`.

## 5. Known limitations

- Thresholds follow common public guidance (for example, WHO IMCI-style danger signs) and are **not clinically validated**.
- Symptom input is a checklist. The engine cannot judge severity beyond what the checklist captures. For example, "difficulty breathing" doesn't distinguish mild from severe.
- Demo data (`npm run seed`) uses a placeholder model level labelled `modelVersion: "demo-seed"`. Red-flag results in the demo data are produced by the real rule engine.
