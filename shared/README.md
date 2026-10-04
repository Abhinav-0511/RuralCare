# @ruralcare/shared

This folder is the single source of truth for safety-critical data. The client, server and ai-service all read these files directly, so there are no copies to keep in sync.

| File                        | What it holds                                                  | Read by                                                             |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `data/red_flags.json`       | Deterministic red-flag rules → `EMERGENCY`                     | TS engine (client + server), Python engine (ai-service)             |
| `data/symptoms.json`        | Symptom vocabulary with en / ta / hi labels                    | all                                                                 |
| `data/triage_levels.json`   | The 4 triage levels, advice text, disclaimer, emergency number | all                                                                 |
| `tests/red_flag_cases.json` | Golden test cases that **both** engines must pass              | `src/redFlags.golden.test.ts`, `ai-service/tests/test_red_flags.py` |
| `src/`                      | TypeScript schemas (Zod) and the TS rule engine                | client (bundled by Vite), server (bundled by tsup)                  |

The Python engine lives in [`ai-service/app/safety/red_flags.py`](../ai-service/app/safety/red_flags.py). It reads the same JSON files.

## Rule condition grammar

Each condition is an object with **exactly one** key:

| Key                  | Matches when                            |
| -------------------- | --------------------------------------- |
| `anySymptoms: [ids]` | at least one of the symptoms is present |
| `allSymptoms: [ids]` | all of the symptoms are present         |
| `ageMonthsLt: n`     | age in months < n                       |
| `ageMonthsGte: n`    | age in months ≥ n                       |
| `pregnant: bool`     | pregnancy status equals the value       |
| `temperatureCGte: n` | measured temperature (°C) ≥ n           |
| `all: [conditions]`  | every sub-condition matches             |
| `any: [conditions]`  | at least one sub-condition matches      |

A condition on a value the user didn't provide (for example, age unknown) evaluates to **false**.

Both engines **refuse to start** in any of these cases:

- the rule file is malformed,
- a rule id is duplicated,
- a rule references a symptom that is not in the vocabulary,
- a label is missing a language.

## Changing a rule

1. Edit `data/red_flags.json`. Bump `version` too.
2. Add or adjust cases in `tests/red_flag_cases.json`, including boundary cases.
3. Run both test suites:
   ```bash
   npm test -w @ruralcare/shared
   cd ai-service && .venv/Scripts/python -m pytest   # or .venv/bin/python on macOS/Linux
   ```
