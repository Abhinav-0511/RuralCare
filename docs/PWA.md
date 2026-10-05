# RuralCare PWA: offline design

The client ([`client/`](../client/)) is a React + TypeScript Progressive Web App. A health worker or patient can open it, triage a patient and see a result **with no network at all**. Results made offline are queued and synced when the connection returns.

## 1. What works offline

| Feature                                                    | Offline                                  |
| ---------------------------------------------------------- | ---------------------------------------- |
| Open the app (every route), log-in session, language       | ✅ (after one online visit)              |
| Triage wizard → result (rules, safety floors, model)       | ✅                                       |
| History of triages made on this device, pending-sync count | ✅                                       |
| Patient list (health worker) for choosing the patient      | ✅ (cached from the last online visit)   |
| Dashboards: alerts, review queue, vitals charts, stats     | Open, but show "needs internet"          |
| Device vitals in triage                                    | ❌ added by the server at sync time (§4) |

## 2. Building blocks

| Part            | Implementation                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service worker  | `vite-plugin-pwa` (Workbox). Precaches the app shell, every route chunk and the icons (~620 KB raw). The charts chunk is cached on first use; the onnxruntime-web fallback is never precached.                  |
| Local storage   | IndexedDB via Dexie ([`client/src/lib/db.ts`](../client/src/lib/db.ts)): `sessions` (also the outbox, by `syncStatus`), `patients` (cache), `model` (ONNX bytes + metadata).                                    |
| Connectivity    | `navigator.onLine` plus a `/health` ping ([`connectivity.tsx`](../client/src/lib/connectivity.tsx)). A "connected to Wi-Fi but no internet" phone is treated as offline.                                        |
| Triage decision | The same `decideTriage()` from `/shared` that the server uses, with the same rules, floors and condition → level table ([`localTriage.ts`](../client/src/triage/localTriage.ts)).                               |
| Sync            | [`sync.ts`](../client/src/triage/sync.ts): `POST /api/triage/sync`, idempotent by client UUID. Runs on reconnect and every 10 s while sessions are pending; each failed session backs off from 5 s up to 5 min. |
| i18n            | English, Tamil, Hindi. Symptom search works in all three; voice input uses the Web Speech API where the browser supports it.                                                                                    |

### Submit flow ([`submit.ts`](../client/src/triage/submit.ts))

1. **Online:** `POST /api/triage`. The server decides (its rules, the patient's device vitals, the online model). The session is stored locally as `synced`.
2. **Offline, or the request fails with a network error:** the device decides with the shared rules + the offline model and stores the session as `pending`.
3. **After sync:** the server re-checks every offline session. If its level differs (most often because device vitals it can see were abnormal), the app shows a clear "the server's result differs" message, and the server result is the one that counts.

The result screen shows where the result came from: _online model_, _offline model_, _rules_ (red flag) or _rules only_ (model unavailable).

## 3. Model runtime: built-in interpreter, onnxruntime-web as fallback

**Decision (approved):** offline predictions use a small built-in ONNX interpreter ([`client/src/model/onnxLite.ts`](../client/src/model/onnxLite.ts)). onnxruntime-web is kept only as an automatic fallback.

**Why.** The model is a 27 KB logistic regression (131 features, 41 classes). onnxruntime-web's smallest WebAssembly build is **14.2 MB (3.7 MB gzipped)**. On the slow 2G/3G links common in rural areas, that is minutes of download and mobile data for a runtime ~140× larger than the model it runs, and it would dominate the offline precache. The built-in interpreter reads the **same `.onnx` file** (no separate export, no second source of truth) and adds a few KB to the bundle.

**How it works.** `onnxLite` decodes the ONNX protobuf and supports exactly the operators this model uses (`LinearClassifier`, `Normalizer`). Any other operator raises `UnsupportedModelError`. `createPredictor()` in [`modelManager.ts`](../client/src/model/modelManager.ts) catches that and lazily imports the CPU-only `onnxruntime-web/wasm` build, so a future model type (e.g. a tree ensemble) still works without code changes. The predictor reports which runtime it used (`built-in` or `onnxruntime-web`).

**How parity is tested.** Both checks run in `npm test` and in CI, against the model file the PWA actually serves:

| Test                                                         | Checks                                                                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`onnxLite.test.ts`](../client/src/model/onnxLite.test.ts)   | Built-in interpreter vs scikit-learn's `predict_proba` on the 112 fixtures exported with the model (`ai-service/models/parity_fixtures.json`), max difference < 1e-5. |
|                                                              | Built-in interpreter vs **onnxruntime-node** (same ONNX Runtime kernels as onnxruntime-web) on the same batch, max difference < 1e-5.                                 |
|                                                              | Probabilities sum to 1; an unsupported file throws `UnsupportedModelError` (the fallback trigger).                                                                    |
| [`model.parity.test.ts`](../client/src/model.parity.test.ts) | The served file's sha256 matches its metadata and the fixtures; onnxruntime-node reproduces scikit-learn within 1e-5 using the shared `buildFeatureVector()`.         |
| Python `ai-service` tests                                    | scikit-learn ↔ onnxruntime (Python) on the same fixtures.                                                                                                             |

So the browser, the Node test and the AI service all agree with the original scikit-learn model to within 1e-5. The fallback path itself is not exercised in a real browser, because the current model never triggers it; its correctness rests on onnxruntime-web using the same kernels as onnxruntime-node.

**Model updates.** When online, the app calls `GET /api/model/version`. It downloads `/models/triage_model.onnx` only if the sha256 changed, verifies the download's sha256, checks that it actually loads, and only then replaces the copy in IndexedDB. A failed or mismatched download keeps the previous model. Without any model the app still triages with rules only (at least `SEE_DOCTOR_SOON`, never `SELF_CARE`).

## 4. Known limitations

- **Dashboards need the internet.** They open offline but say so; only the triage wizard, results and history work fully offline.
- **Offline triage can't see device vitals.** The phone has no access to them. The server adds them at sync time and the "server result differs" message covers the case (tested in e2e).
- **Secure context needed for crypto.** sha256 model verification and `crypto.randomUUID` need https or localhost. On a plain-http LAN address the app skips verification and uses its own UUID fallback.
- **Lighthouse no longer has a PWA category** (removed in v12). Installability is checked with Chrome's `Page.getInstallabilityErrors` in an e2e test instead.

## 5. Performance

Lighthouse 13.5, mobile, simulated slow 4G, 4× CPU slowdown, `/login` ([report](lighthouse/login.report.html)):

| Performance | Accessibility | Best practices |     SEO | FCP   | LCP   | TBT    | CLS | Transfer |
| ----------: | ------------: | -------------: | ------: | ----- | ----- | ------ | --- | -------- |
|      **90** |       **100** |        **100** | **100** | 2.5 s | 3.0 s | 110 ms | 0   | 253 KB   |

Bundle (gzipped): main JS 180 KB (mostly React DOM, React Router, Zod), CSS 4 KB, each dashboard page 1–1.4 KB, charts ~118 KB (lazy). Touch targets are at least 48 px, and every screen is tested at 360 px width. An inline splash in `index.html` paints before the JS loads.

## 6. End-to-end tests

Playwright ([`client/e2e/`](../client/e2e/)) drives the real Docker stack as a Pixel 5-sized phone (360×740, touch). `globalSetup` re-seeds the database first.

```bash
docker compose -f infra/docker-compose.yml up -d --build --wait
npx playwright install chromium        # once
npm run e2e -w @ruralcare/client       # HTML report: client/playwright-report/
```

| Spec                 | Covers                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `triage.spec.ts`     | Online model result with conditions, advice and disclaimer · danger sign → EMERGENCY + Call 108 · severity safety floor · offline → triage → online → synced · server verdict differs       |
| `pwa.spec.ts`        | Chrome installability (0 errors) · the whole app opens with no network after one visit                                                                                                      |
| `dashboards.spec.ts` | Alert acknowledge (via a real MQTT reading) · doctor review queue (emergencies first), note, mark reviewed · patient charts · admin stats · language switch, no horizontal scroll at 360 px |

CI runs the same suite in the `e2e` job.
