"""Train, evaluate, compare and export the RuralCare triage model.

Usage (from ai-service/):  python -m training.train

Steps
1. Load + verify the Kaggle dataset; collapse the 4920 rows to their unique (disease, symptoms) cases.
2. 5-fold stratified cross-validation on the unique cases for each candidate model, scored on:
   - the clean held-out fold, and
   - a NOISY copy of it (30-50% of symptoms dropped, 1-2 unrelated symptoms added), and
   - end-to-end triage on the noisy copy (red-flag rules -> model -> policy), incl. under-triage.
3. Pick the model with the best NOISY top-1 accuracy, retrain it on all unique cases, export to ONNX,
   check sklearn == onnxruntime, and write the model, metadata, parity fixtures, copies for the PWA,
   and docs/MODEL_REPORT.md.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np
import onnxruntime as ort
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
from sklearn.base import ClassifierMixin
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, log_loss
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.naive_bayes import BernoulliNB

from app.model.conditions import ConditionsFile, load_conditions
from app.model.policy import RankedCondition, most_severe, prediction_level
from app.model.predictor import METADATA_FILE, MODEL_FILE
from app.safety.red_flags import TRIAGE_LEVELS, RedFlagEngine, TriageContext
from training import report
from training.dataset import (
    AI_SERVICE_DIR,
    EXPECTED_FILES,
    KAGGLE_REF,
    KAGGLE_URL,
    KAGGLE_VERSION,
    LICENSE,
    REPO_ROOT,
    Case,
    load_cases,
    unique_cases,
)

SEED = 42
N_FOLDS = 5
NOISY_VARIANTS = 10  # noisy copies per held-out case
DROP_FRACTION = (0.3, 0.5)
ADD_UNRELATED = (1, 2)
ADULT_AGE_MONTHS = 30 * 12  # end-to-end evaluation assumes an adult (no infant/fever floors)
PARITY_TOLERANCE = 1e-5
ONNX_OPSET = {"": 15, "ai.onnx.ml": 3}
# Logistic regression's C barely changes accuracy here but strongly changes calibration, which the
# low-confidence rule depends on, so it is tuned (by noisy log-loss) rather than left at the default.
LR_C_GRID = [1.0, 10.0, 100.0, 1000.0, 10000.0]

SHARED_DIR = REPO_ROOT / "shared"
MODELS_DIR = AI_SERVICE_DIR / "models"
CLIENT_MODELS_DIR = REPO_ROOT / "client" / "public" / "models"
DOCS_DIR = REPO_ROOT / "docs"
FIXTURES_FILE = "parity_fixtures.json"


@dataclass(frozen=True)
class Candidate:
    key: str
    label: str
    short: str
    make: Callable[[], ClassifierMixin]


def logistic_regression(c: float) -> Callable[[], ClassifierMixin]:
    return lambda: LogisticRegression(C=c, max_iter=10_000)


CANDIDATES = [
    Candidate(
        "logistic_regression", "Logistic Regression", "lr", logistic_regression(1.0)
    ),  # C tuned in main()
    Candidate(
        "random_forest",
        "Random Forest (100 trees)",
        "rf",
        lambda: RandomForestClassifier(n_estimators=100, random_state=SEED, n_jobs=-1),
    ),
    Candidate("naive_bayes", "Bernoulli Naive Bayes", "nb", lambda: BernoulliNB(alpha=1.0)),
]


# ───────────────────────────── data ─────────────────────────────


@dataclass
class Data:
    features: list[str]
    classes: list[str]  # condition ids, model output order
    unique: list[Case]
    x: np.ndarray
    y: np.ndarray
    universe: dict[int, frozenset[str]]  # every symptom seen with each class


def encode(symptom_sets: list[frozenset[str]] | list[list[str]], features: list[str]) -> np.ndarray:
    index = {f: i for i, f in enumerate(features)}
    x = np.zeros((len(symptom_sets), len(features)), dtype=np.float32)
    for row, symptoms in enumerate(symptom_sets):
        for s in symptoms:
            x[row, index[s]] = 1.0
    return x


def build_data(cases: list[Case], conditions: ConditionsFile) -> Data:
    by_name = conditions.by_dataset_name()
    missing = {c.disease for c in cases} - set(by_name)
    if missing:
        raise SystemExit(f"Diseases missing from shared/data/conditions.json: {sorted(missing)}")

    vocab = {
        s["id"]
        for s in json.loads((SHARED_DIR / "data" / "symptoms.json").read_text(encoding="utf-8"))["symptoms"]
    }
    features = sorted({s for c in cases for s in c.symptoms})
    if not set(features) <= vocab:
        raise SystemExit(f"Symptoms missing from shared/data/symptoms.json: {sorted(set(features) - vocab)}")

    classes = sorted(by_name[c.disease].id for c in {c.disease: c for c in cases}.values())
    class_index = {cid: i for i, cid in enumerate(classes)}
    unique = unique_cases(cases)
    y = np.array([class_index[by_name[c.disease].id] for c in unique])
    universe: dict[int, set[str]] = {}
    for case, label in zip(unique, y, strict=True):
        universe.setdefault(int(label), set()).update(case.symptoms)
    return Data(
        features, classes, unique, encode([c.symptoms for c in unique], features), y,
        {k: frozenset(v) for k, v in universe.items()},
    )  # fmt: skip


def make_noisy(
    cases: list[tuple[frozenset[str], int]],
    data: Data,
    excluded: frozenset[str],
    rng: np.random.Generator,
    variants: int = NOISY_VARIANTS,
) -> list[tuple[list[str], int]]:
    """Simulates incomplete reporting: drop 30-50% of symptoms (keep >= 1) and add 1-2 unrelated ones.

    'Unrelated' = never seen with that disease in the dataset. Red-flag symptoms are never added:
    any of them sends the patient to EMERGENCY before the model runs, so the model never sees them.
    """
    out: list[tuple[list[str], int]] = []
    for symptoms, label in cases:
        ordered = sorted(symptoms)
        candidates = sorted(set(data.features) - data.universe[label] - excluded)
        for _ in range(variants):
            n_drop = int(round(rng.uniform(*DROP_FRACTION) * len(ordered)))
            n_keep = max(1, len(ordered) - n_drop)
            kept = list(rng.choice(ordered, size=n_keep, replace=False))
            n_add = int(rng.integers(ADD_UNRELATED[0], ADD_UNRELATED[1] + 1))
            added = list(rng.choice(candidates, size=n_add, replace=False))
            out.append((sorted(kept + added), label))
    return out


# ───────────────────────────── metrics ─────────────────────────────


def proba(model: ClassifierMixin, x: np.ndarray, n_classes: int) -> np.ndarray:
    assert list(model.classes_) == list(range(n_classes)), "every class must be present in the training fold"
    return model.predict_proba(x)


def expected_calibration_error(p: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    """Average |accuracy - confidence| over 10 confidence bins, weighted by bin size (0 = perfect)."""
    conf = p.max(axis=1)
    correct = p.argmax(axis=1) == y
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        in_bin = (conf > lo) & (conf <= hi)
        if in_bin.any():
            total += in_bin.mean() * abs(correct[in_bin].mean() - conf[in_bin].mean())
    return float(total)


def accuracy_metrics(p: np.ndarray, y: np.ndarray) -> dict[str, float]:
    top3 = np.argsort(-p, axis=1)[:, :3]
    pred = p.argmax(axis=1)
    return {
        "top1": float(np.mean(pred == y)),
        "top3": float(np.mean([label in row for label, row in zip(y, top3, strict=True)])),
        "macro_f1": float(f1_score(y, pred, average="macro", labels=range(p.shape[1]), zero_division=0)),
        "log_loss": float(log_loss(y, np.clip(p, 1e-15, 1), labels=range(p.shape[1]))),
        "ece": expected_calibration_error(p, y),
    }


def severity(level: str) -> int:
    return len(TRIAGE_LEVELS) - TRIAGE_LEVELS.index(level)


@dataclass
class TriageOutcome:
    expected: list[str] = field(default_factory=list)
    predicted: list[str] = field(default_factory=list)
    low_confidence: list[bool] = field(default_factory=list)

    def summary(self) -> dict[str, float]:
        exp = np.array([severity(e) for e in self.expected])
        pred = np.array([severity(p) for p in self.predicted])
        return {
            "triage_exact": float(np.mean(exp == pred)),
            "under_triage": float(np.mean(pred < exp)),
            "over_triage": float(np.mean(pred > exp)),
            "emergency": float(np.mean([p == "EMERGENCY" for p in self.predicted])),
            "self_care_low_confidence": float(
                np.mean(
                    [
                        p == "SELF_CARE" and low
                        for p, low in zip(self.predicted, self.low_confidence, strict=True)
                    ]
                )
            ),
        }


def end_to_end_triage(
    noisy: list[tuple[list[str], int]],
    p: np.ndarray,
    data: Data,
    engine: RedFlagEngine,
    conditions: ConditionsFile,
    out: TriageOutcome,
) -> None:
    """What a patient would actually be told: rules first, then model + policy (production order)."""
    for (symptoms, label), probs in zip(noisy, p, strict=True):
        rf = engine.evaluate(TriageContext(symptoms=symptoms, age_months=ADULT_AGE_MONTHS))
        out.expected.append(conditions.get(data.classes[label]).triageLevel)
        if rf.is_emergency:
            out.predicted.append("EMERGENCY")
            out.low_confidence.append(False)
            continue
        order = np.argsort(-probs, kind="stable")
        ranked = [RankedCondition(data.classes[i], float(probs[i])) for i in order]
        result = prediction_level(ranked, len(symptoms), [], conditions)
        out.predicted.append(most_severe(result.level, rf.minimum_level))
        out.low_confidence.append(result.low_confidence)


# ───────────────────────────── ONNX ─────────────────────────────


def to_onnx_bytes(model: ClassifierMixin, n_features: int) -> bytes:
    onx = convert_sklearn(
        model,
        initial_types=[("symptoms", FloatTensorType([None, n_features]))],
        options={id(model): {"zipmap": False}},
        target_opset=ONNX_OPSET,
    )
    names = [o.name for o in onx.graph.output]
    assert names == ["label", "probabilities"], names
    # skl2onnx names the graph with a random UUID; a fixed name makes the export (and its sha256,
    # which the PWA uses to decide whether to re-download) reproducible.
    onx.graph.name = "ruralcare_triage"
    return onx.SerializeToString()


def onnx_proba(model_bytes: bytes, x: np.ndarray) -> np.ndarray:
    session = ort.InferenceSession(model_bytes, providers=["CPUExecutionProvider"])
    return np.asarray(session.run(["probabilities"], {"symptoms": x})[0], dtype=np.float64)


# ───────────────────────────── main ─────────────────────────────


def main() -> None:
    started = time.time()
    cases = load_cases()
    conditions = load_conditions(SHARED_DIR)
    engine = RedFlagEngine.from_shared_dir(SHARED_DIR)
    data = build_data(cases, conditions)
    n_classes = len(data.classes)
    print(
        f"{len(cases)} rows -> {len(data.unique)} unique cases, {len(data.features)} features, {n_classes} classes"
    )

    rng = np.random.default_rng(SEED)
    folds = list(StratifiedKFold(N_FOLDS, shuffle=True, random_state=SEED).split(data.x, data.y))
    # The same noisy test sets are used for every model.
    noisy_folds = [
        make_noisy(
            [(data.unique[i].symptoms, int(data.y[i])) for i in test], data, engine.red_flag_symptoms, rng
        )
        for _, test in folds
    ]

    # Tune logistic regression's C on the same folds (noisy log-loss); reported in MODEL_REPORT.md section 6.
    c_sweep = []
    for c in LR_C_GRID:
        p_all, y_all = [], []
        for (train, _), noisy in zip(folds, noisy_folds, strict=True):
            model = logistic_regression(c)().fit(data.x[train], data.y[train])
            p_all.append(proba(model, encode([s for s, _ in noisy], data.features), n_classes))
            y_all.append(np.array([label for _, label in noisy]))
        p_cat, y_cat = np.vstack(p_all), np.concatenate(y_all)
        confident = float(np.mean(p_cat.max(axis=1) >= conditions.policy.minConfidence))
        c_sweep.append({"C": c, **accuracy_metrics(p_cat, y_cat), "confident": confident})
    best_c = min(c_sweep, key=lambda r: r["log_loss"])["C"]
    CANDIDATES[0] = Candidate(
        "logistic_regression", f"Logistic Regression (C={best_c:g})", "lr", logistic_regression(best_c)
    )
    print("LR C sweep (noisy log-loss): " + ", ".join(f"C={r['C']:g}: {r['log_loss']:.3f}" for r in c_sweep))

    results: dict[str, dict] = {}
    for cand in CANDIDATES:
        clean_scores, noisy_scores = [], []
        triage = TriageOutcome()
        oof_clean = np.zeros((len(data.y), n_classes))
        noisy_p_all, noisy_y_all = [], []
        for (train, test), noisy in zip(folds, noisy_folds, strict=True):
            model = cand.make().fit(data.x[train], data.y[train])
            p_clean = proba(model, data.x[test], n_classes)
            oof_clean[test] = p_clean
            clean_scores.append(accuracy_metrics(p_clean, data.y[test]))
            x_noisy = encode([s for s, _ in noisy], data.features)
            y_noisy = np.array([label for _, label in noisy])
            p_noisy = proba(model, x_noisy, n_classes)
            noisy_scores.append(accuracy_metrics(p_noisy, y_noisy))
            noisy_p_all.append(p_noisy)
            noisy_y_all.append(y_noisy)
            end_to_end_triage(noisy, p_noisy, data, engine, conditions, triage)

        final = cand.make().fit(data.x, data.y)
        model_bytes = to_onnx_bytes(final, len(data.features))
        parity = float(np.max(np.abs(onnx_proba(model_bytes, data.x) - final.predict_proba(data.x))))

        def mean_std(scores: list[dict[str, float]], key: str) -> tuple[float, float]:
            vals = [s[key] for s in scores]
            return float(np.mean(vals)), float(np.std(vals))

        results[cand.key] = {
            "label": cand.label,
            "clean": {k: mean_std(clean_scores, k) for k in clean_scores[0]},
            "noisy": {k: mean_std(noisy_scores, k) for k in noisy_scores[0]},
            "triage": triage.summary(),
            "triage_outcome": triage,
            "onnx_bytes": len(model_bytes),
            "parity_max_abs_diff": parity,
            "oof_clean": oof_clean,
            "noisy_p": np.vstack(noisy_p_all),
            "noisy_y": np.concatenate(noisy_y_all),
            "final": final,
            "model_bytes": model_bytes,
        }
        r = results[cand.key]
        print(
            f"{cand.label:28s} clean top1 {r['clean']['top1'][0]:.3f}  noisy top1 {r['noisy']['top1'][0]:.3f}  "
            f"noisy top3 {r['noisy']['top3'][0]:.3f}  under-triage {r['triage']['under_triage']:.3f}  "
            f"onnx {len(model_bytes) / 1024:.1f} KB  parity {parity:.1e}"
        )

    # Leaky baseline: the usual random split over all 4920 rows, duplicates included.
    all_x = encode([c.symptoms for c in cases], data.features)
    by_name = conditions.by_dataset_name()
    all_y = np.array([data.classes.index(by_name[c.disease].id) for c in cases])
    tr, te = train_test_split(np.arange(len(cases)), test_size=0.2, stratify=all_y, random_state=SEED)
    train_keys = {(cases[i].disease, cases[i].symptoms) for i in tr}
    leak_share = float(np.mean([(cases[i].disease, cases[i].symptoms) in train_keys for i in te]))
    leaky = {
        c.key: float(np.mean(c.make().fit(all_x[tr], all_y[tr]).predict(all_x[te]) == all_y[te]))
        for c in CANDIDATES
    }

    # Pick: best noisy top-1; ties broken by lower under-triage, then smaller file.
    chosen_key = max(
        results,
        key=lambda k: (
            round(results[k]["noisy"]["top1"][0], 3),
            -results[k]["triage"]["under_triage"],
            -results[k]["onnx_bytes"],
        ),
    )
    chosen = results[chosen_key]
    cand = next(c for c in CANDIDATES if c.key == chosen_key)
    if chosen["parity_max_abs_diff"] > PARITY_TOLERANCE:
        raise SystemExit(f"ONNX parity check failed: {chosen['parity_max_abs_diff']}")

    model_bytes: bytes = chosen["model_bytes"]
    sha = hashlib.sha256(model_bytes).hexdigest()
    created = datetime.now(UTC).replace(microsecond=0)
    version = f"{cand.short}-{created:%Y%m%d}-{sha[:8]}"

    fixtures = build_fixtures(data, chosen["final"], engine, rng, version, sha)
    metadata = {
        "modelVersion": version,
        "algorithm": cand.label,
        "hyperparameters": {
            k: v for k, v in chosen["final"].get_params().items() if k in ("C", "n_estimators", "alpha")
        },
        "createdAt": created.isoformat().replace("+00:00", "Z"),
        "sha256": sha,
        "sizeBytes": len(model_bytes),
        "onnx": {"inputName": "symptoms", "outputName": "probabilities", "opset": ONNX_OPSET[""]},
        "trainedOnUniqueCases": len(data.unique),
        "metrics": {
            "cvFolds": N_FOLDS,
            "cleanTop1": round(chosen["clean"]["top1"][0], 4),
            "noisyTop1": round(chosen["noisy"]["top1"][0], 4),
            "noisyTop3": round(chosen["noisy"]["top3"][0], 4),
            "noisyUnderTriage": round(chosen["triage"]["under_triage"], 4),
        },
        "dataset": {"ref": KAGGLE_REF, "version": KAGGLE_VERSION, "license": LICENSE, "url": KAGGLE_URL},
        "conditionsVersion": conditions.version,
        "features": data.features,
        "classes": data.classes,
    }

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    (MODELS_DIR / MODEL_FILE).write_bytes(model_bytes)
    write_json(MODELS_DIR / METADATA_FILE, metadata)
    write_json(MODELS_DIR / FIXTURES_FILE, fixtures)
    CLIENT_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for name in (MODEL_FILE, METADATA_FILE):
        shutil.copyfile(MODELS_DIR / name, CLIENT_MODELS_DIR / name)

    report.write_report(
        DOCS_DIR,
        results=results,
        chosen_key=chosen_key,
        data=data,
        conditions=conditions,
        metadata=metadata,
        leaky=leaky,
        leak_share=leak_share,
        n_rows=len(cases),
        dataset_files=EXPECTED_FILES,
        settings={
            "seed": SEED,
            "folds": N_FOLDS,
            "variants": NOISY_VARIANTS,
            "drop": DROP_FRACTION,
            "add": ADD_UNRELATED,
            "age_months": ADULT_AGE_MONTHS,
            "fixtures": len(fixtures["cases"]),
            "c_sweep": c_sweep,
            "best_c": best_c,
        },
    )
    print(
        f"Chosen: {cand.label} -> {version} ({len(model_bytes) / 1024:.1f} KB) in {time.time() - started:.0f}s"
    )


def build_fixtures(
    data: Data,
    model: ClassifierMixin,
    engine: RedFlagEngine,
    rng: np.random.Generator,
    version: str,
    sha: str,
) -> dict:
    """Reference sklearn outputs; the Python and Node (onnxruntime-node) parity tests replay these."""
    pick = rng.permutation(len(data.unique))[:40]
    inputs: list[list[str]] = [sorted(data.unique[i].symptoms) for i in pick]
    noisy = make_noisy(
        [(data.unique[i].symptoms, int(data.y[i])) for i in rng.permutation(len(data.unique))[:30]],
        data,
        engine.red_flag_symptoms,
        rng,
        variants=2,
    )
    inputs += [s for s, _ in noisy]
    inputs += [[]]  # no symptoms at all
    inputs += [[f] for f in data.features[::13]]  # single symptoms
    p = model.predict_proba(encode(inputs, data.features))
    return {
        "notes": "sklearn predict_proba for these inputs at export time. onnxruntime (Python, Node, browser) "
        "must reproduce them within `tolerance`.",
        "modelVersion": version,
        "sha256": sha,
        "tolerance": 1e-5,
        "cases": [
            {"symptoms": s, "probabilities": [round(float(v), 9) for v in row]}
            for s, row in zip(inputs, p, strict=True)
        ],
    }


def write_json(path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
