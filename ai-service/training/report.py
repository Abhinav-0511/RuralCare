"""Writes docs/MODEL_REPORT.md and the confusion-matrix images from a training run."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

if TYPE_CHECKING:
    from app.model.conditions import ConditionsFile
    from training.train import Data

RATIONALE = {
    "logistic_regression": (
        "Logistic regression adds up evidence from each symptom independently, so when some symptoms are "
        "missing the remaining ones still point the right way and the probabilities shrink gracefully instead of "
        "collapsing. It is also among the smallest and fastest models to run in the browser. With the tuned C "
        "(below) it also has the lowest noisy log-loss of the three. Naive Bayes has a slightly lower "
        "calibration error but is about 10 points less accurate, and good probabilities matter because the "
        "low-confidence rule relies on them."
    ),
    "random_forest": (
        "The random forest copes best with missing and unrelated symptoms because many trees vote on different "
        "symptom subsets. The cost is a larger file and less calibrated probabilities."
    ),
    "naive_bayes": (
        "Naive Bayes treats each symptom as independent evidence, which suits this one-hot symptom data, "
        "and it is tiny to ship. Its probabilities tend to be over-confident, which the low-confidence rule must "
        "account for."
    ),
}


def pct(v: float) -> str:
    return f"{100 * v:.1f}%"


def pm(v: tuple[float, float]) -> str:
    return f"{100 * v[0]:.1f} ± {100 * v[1]:.1f}"


def plot_confusion(cm: np.ndarray, labels: list[str], title: str, path: Path) -> None:
    norm = cm / np.maximum(cm.sum(axis=1, keepdims=True), 1)
    fig, ax = plt.subplots(figsize=(15, 13))
    im = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(labels)), labels, rotation=90, fontsize=7)
    ax.set_yticks(range(len(labels)), labels, fontsize=7)
    ax.set_xlabel("Predicted (top-1)")
    ax.set_ylabel("True condition")
    ax.set_title(title)
    fig.colorbar(im, ax=ax, fraction=0.03, label="Share of true-class cases")
    fig.tight_layout()
    fig.savefig(path, dpi=90)
    plt.close(fig)


def confusion(y: np.ndarray, pred: np.ndarray, n: int) -> np.ndarray:
    cm = np.zeros((n, n), dtype=int)
    for t, p in zip(y, pred, strict=True):
        cm[t, p] += 1
    return cm


DENGUE_EXAMPLE = ["high_fever", "joint_pain", "pain_behind_the_eyes", "skin_rash"]


def dengue_example(model, data, conditions) -> tuple[list[tuple[str, float]], str, bool]:
    """Top-3 conditions and final policy level for DENGUE_EXAMPLE (adult, no red flags)."""
    from app.model.policy import RankedCondition, prediction_level

    x = np.zeros((1, len(data.features)), dtype=np.float32)
    for sid in DENGUE_EXAMPLE:
        x[0, data.features.index(sid)] = 1
    probs = model.predict_proba(x)[0]
    order = np.argsort(-probs, kind="stable")
    ranked = [RankedCondition(data.classes[i], float(probs[i])) for i in order]
    result = prediction_level(ranked, len(DENGUE_EXAMPLE), [], conditions)
    return [(r.id, r.probability) for r in ranked[:3]], result.level, result.low_confidence


def write_report(
    docs_dir: Path,
    *,
    results: dict,
    chosen_key: str,
    data: Data,
    conditions: ConditionsFile,
    metadata: dict,
    leaky: dict[str, float],
    leak_share: float,
    n_rows: int,
    dataset_files: dict,
    settings: dict,
) -> None:
    img_dir = docs_dir / "model"
    img_dir.mkdir(parents=True, exist_ok=True)
    chosen = results[chosen_key]
    names = [conditions.get(c).name.en for c in data.classes]
    n = len(data.classes)

    cm_clean = confusion(data.y, chosen["oof_clean"].argmax(axis=1), n)
    cm_noisy = confusion(chosen["noisy_y"], chosen["noisy_p"].argmax(axis=1), n)
    plot_confusion(
        cm_clean,
        names,
        f"{chosen['label']}: clean held-out cases (5-fold CV)",
        img_dir / "confusion_clean.png",
    )
    plot_confusion(
        cm_noisy,
        names,
        f"{chosen['label']}: noisy held-out cases (5-fold CV)",
        img_dir / "confusion_noisy.png",
    )

    off = [(cm_noisy[t, p], t, p) for t in range(n) for p in range(n) if t != p and cm_noisy[t, p] > 0]
    off.sort(reverse=True)
    per_class = cm_noisy.sum(axis=1)

    policy = conditions.policy
    top_p = chosen["noisy_p"].max(axis=1)
    correct = chosen["noisy_p"].argmax(axis=1) == chosen["noisy_y"]
    confident = top_p >= policy.minConfidence

    triage = chosen["triage_outcome"]
    level_cols = ["EMERGENCY", "SEE_DOCTOR_24H", "SEE_DOCTOR_SOON", "SELF_CARE"]
    level_counts = Counter(zip(triage.expected, triage.predicted, strict=True))
    unique_per_class = Counter(int(v) for v in data.y)

    ranking = sorted(results, key=lambda k: -results[k]["noisy"]["top1"][0])
    runner_up = results[ranking[1]] if ranking[0] == chosen_key else results[ranking[0]]

    lines: list[str] = []
    w = lines.append
    w("# RuralCare triage model report")
    w("")
    w(
        f"> Generated by `python -m training.train` on {datetime.now(UTC):%Y-%m-%d %H:%M} UTC. "
        "Don't edit by hand; re-run the script."
    )
    w(">")
    w(
        "> ⚠️ **This model is not a diagnosis tool and is not clinically validated.** It suggests *possible* "
        "conditions to support triage. Red-flag symptoms are handled by deterministic rules before the model "
        "runs (see [SAFETY.md](SAFETY.md)). The condition-to-triage table must be reviewed by a doctor before "
        "any real use."
    )
    w("")
    w("## 1. Summary")
    w("")
    w("| | |")
    w("|---|---|")
    w(f"| Chosen model | **{chosen['label']}** (`{metadata['modelVersion']}`) |")
    w(f"| Chosen because | best top-1 accuracy on the **noisy** test set: {pm(chosen['noisy']['top1'])}% |")
    w(f"| Noisy top-3 accuracy | {pm(chosen['noisy']['top3'])}% |")
    w(f"| Clean top-1 accuracy | {pm(chosen['clean']['top1'])}% |")
    w(f"| Under-triage on noisy cases (end-to-end) | {pct(chosen['triage']['under_triage'])} |")
    w(f"| ONNX file size | **{metadata['sizeBytes'] / 1024:.1f} KB** (target < 2 MB) |")
    w(f"| sklearn vs onnxruntime max difference | {chosen['parity_max_abs_diff']:.1e} |")
    w("")
    w("## 2. Dataset")
    w("")
    w(
        f"[Disease Symptom Prediction]({metadata['dataset']['url']}) by Pranay Patil (Kaggle "
        f"`{metadata['dataset']['ref']}`, version {metadata['dataset']['version']}), licensed "
        f"**{metadata['dataset']['license']}**. The raw CSVs are not committed. "
        "`python -m training.fetch_dataset` downloads them and `python -m training.check_dataset` verifies them:"
    )
    w("")
    w("| File | sha256 | Columns |")
    w("|---|---|---|")
    for name, spec in dataset_files.items():
        w(f"| `{name}` | `{spec['sha256'][:16]}…` | {len(spec['columns'])} |")
    w("")
    w(
        f"- {n_rows} rows = {n} diseases × 120 rows, {len(data.features)} distinct symptoms (names cleaned, e.g. "
        "`dischromic _patches` → `dischromic_patches`)."
    )
    w(
        f"- **Only {len(data.unique)} rows are unique.** Each (disease, symptom set) pair is repeated about "
        f"{n_rows / len(data.unique):.0f} times. Unique cases per disease: {min(unique_per_class.values())} to "
        f"{max(unique_per_class.values())}."
    )
    w(
        "- No symptom set appears under two different diseases, so the data is perfectly separable: it is near-synthetic."
    )
    w("")
    w("## 3. Why the usual evaluation is misleading")
    w("")
    w(
        f"With the common random 80/20 split over all {n_rows} rows, **{pct(leak_share)} of test rows also appear, "
        "word for word, in the training set**. The models are just recognising rows they have seen:"
    )
    w("")
    w("| Model | Top-1 accuracy with the leaky split |")
    w("|---|---|")
    for k, v in leaky.items():
        w(f"| {results[k]['label']} | {pct(v)} |")
    w("")
    w(
        f"So every number below uses only the **{len(data.unique)} unique cases**, with stratified "
        f"{settings['folds']}-fold cross-validation. No test case is ever seen in training."
    )
    w("")
    w("## 4. Evaluation protocol")
    w("")
    w("- **Clean test set:** the held-out fold, exactly as in the dataset.")
    w(
        f"- **Noisy test set:** {settings['variants']} copies of every held-out case. Each copy drops "
        f"{int(settings['drop'][0] * 100)}–{int(settings['drop'][1] * 100)}% of the symptoms (keeping at least one) "
        f"and adds {settings['add'][0]}–{settings['add'][1]} unrelated symptoms, meaning ones never seen with that "
        "disease. This simulates patients who describe symptoms incompletely and mention unrelated complaints. "
        "Red-flag symptoms are never *added*, because they trigger EMERGENCY before the model runs. "
        f"Random seed {settings['seed']}; every model sees the same noisy cases."
    )
    w(
        "- **End-to-end triage (noisy set):** each noisy case goes through the production path: red-flag rules, "
        f"then the model, then the prediction policy (adult patient, age {settings['age_months'] // 12} years). The "
        "expected level is the curated level of the true condition (`shared/data/conditions.json`). "
        "**Under-triage** means a less urgent level than expected; this is the safety-critical error."
    )
    w("")
    w(f"## 5. Results (mean ± std over {settings['folds']} folds, %)")
    w("")
    w(
        "| Model | Clean top-1 | Clean top-3 | Clean macro-F1 | **Noisy top-1** | Noisy top-3 | Noisy macro-F1 |"
    )
    w("|---|---|---|---|---|---|---|")
    for k in ranking:
        r = results[k]
        bold = "**" if k == chosen_key else ""
        w(
            f"| {bold}{r['label']}{bold} | {pm(r['clean']['top1'])} | {pm(r['clean']['top3'])} | "
            f"{pm(r['clean']['macro_f1'])} | {bold}{pm(r['noisy']['top1'])}{bold} | {pm(r['noisy']['top3'])} | "
            f"{pm(r['noisy']['macro_f1'])} |"
        )
    w("")
    w("End-to-end triage on the noisy set, plus the export size:")
    w("")
    w(
        "| Model | Noisy log-loss | Noisy calibration error (ECE) | Exact level | **Under-triage** | Over-triage "
        "| Sent to EMERGENCY by rules | ONNX size |"
    )
    w("|---|---|---|---|---|---|---|---|")
    for k in ranking:
        t = results[k]["triage"]
        nz = results[k]["noisy"]
        w(
            f"| {results[k]['label']} | {nz['log_loss'][0]:.3f} | {nz['ece'][0]:.3f} | {pct(t['triage_exact'])} | "
            f"**{pct(t['under_triage'])}** | {pct(t['over_triage'])} | {pct(t['emergency'])} | "
            f"{results[k]['onnx_bytes'] / 1024:.1f} KB |"
        )
    w("")
    w("## 6. Model choice")
    w("")
    w(
        f"**{chosen['label']}** has the best top-1 accuracy on the noisy set ({pm(chosen['noisy']['top1'])}% vs "
        f"{pm(runner_up['noisy']['top1'])}% for {runner_up['label']}). Noisy input is closest to how real "
        "patients describe symptoms, so it is the selection criterion; clean accuracy is near-perfect for "
        "every model and cannot separate them. Ties would be broken by lower under-triage, then smaller file size."
    )
    w("")
    w(RATIONALE[chosen_key])
    w("")
    w("### Tuning logistic regression's regularisation (C)")
    w("")
    w(
        "With scikit-learn's default C = 1, accuracy was already the best of the three, but the probabilities "
        "were heavily *under*-confident. Only about 1-2% of noisy predictions reached the 0.6 confidence "
        "threshold, even though about 95% of the 'unsure' ones were correct. The low-confidence rule then fired "
        "almost every time and SELF_CARE was practically never given. C changes calibration much more than "
        "accuracy, so it is chosen by **noisy log-loss**, a proper scoring rule that rewards accurate *and* "
        "calibrated probabilities:"
    )
    w("")
    w("| C | Noisy top-1 | Noisy log-loss | Calibration error (ECE) | Predictions >= 0.6 confidence |")
    w("|---|---|---|---|---|")
    for r in settings["c_sweep"]:
        mark = "**" if r["C"] == settings["best_c"] else ""
        w(
            f"| {mark}{r['C']:g}{mark} | {pct(r['top1'])} | {mark}{r['log_loss']:.3f}{mark} | {r['ece']:.3f} | "
            f"{pct(r['confident'])} |"
        )
    w("")
    w(
        "Note: C is chosen on the same cross-validation folds that are reported, so logistic regression's "
        "calibration numbers are slightly optimistic. Accuracy is almost flat across C, so the model comparison "
        "itself is not affected. The gain levels off above C = 1000. Such weak regularisation suits this "
        "perfectly separable data, but it is also a warning: on real patients, who don't look like the "
        "dataset, the model may be over-confident. This is why its output never decides EMERGENCY and why "
        "unknown symptoms block SELF_CARE."
    )
    w("")
    w("## 7. Low-confidence rule")
    w("")
    w(
        f"Policy (`shared/data/conditions.json`): below a top-1 probability of **{policy.minConfidence}** the "
        f"result is never SELF_CARE. A runner-up in the top {policy.topK} with probability ≥ "
        f"{policy.escalateRunnerUpMinProbability} can raise the level, and any symptom the model has no feature "
        "for also blocks SELF_CARE."
    )
    w("")
    w(f"On the noisy set with {chosen['label']}:")
    w("")
    w(f"- {pct(float(np.mean(confident)))} of predictions are confident (≥ {policy.minConfidence}).")
    w(
        f"- Top-1 accuracy when confident: {pct(float(np.mean(correct[confident])) if confident.any() else 0)}."
    )
    w(
        "- Top-1 accuracy when not confident: "
        f"{pct(float(np.mean(correct[~confident])) if (~confident).any() else 0)}."
    )
    w(
        f"- SELF_CARE given while confidence was low: {pct(chosen['triage']['self_care_low_confidence'])} "
        "(must be 0)."
    )
    w("")
    w("## 8. Confusion matrices")
    w("")
    w(
        "Rows are true conditions and columns are top-1 predictions, normalised per row. Out-of-fold predictions:"
    )
    w("")
    w("![Clean confusion matrix](model/confusion_clean.png)")
    w("")
    w("![Noisy confusion matrix](model/confusion_noisy.png)")
    w("")
    w("Most frequent confusions on the noisy set:")
    w("")
    w("| True condition | Predicted as | Cases | Share of that condition |")
    w("|---|---|---|---|")
    for count, t, p in off[:12]:
        w(f"| {names[t]} | {names[p]} | {count} | {pct(count / per_class[t])} |")
    w("")
    w("## 9. Triage-level confusion (noisy set, end-to-end)")
    w("")
    w("| Expected \\ Told | " + " | ".join(level_cols) + " |")
    w("|---|" + "---|" * len(level_cols))
    for exp in level_cols[1:]:
        w(f"| {exp} | " + " | ".join(str(level_counts.get((exp, got), 0)) for got in level_cols) + " |")
    w("")
    w(
        "Cells to the right of the diagonal are under-triage. Cells in the EMERGENCY column are cases whose "
        "remaining true symptoms include a red flag (for example, chest pain for a heart attack, breathlessness "
        "for asthma or pneumonia). That over-triage is deliberate (see SAFETY.md §3.1)."
    )
    w("")
    w("## 10. ONNX export and parity")
    w("")
    w(
        f"- `ai-service/models/triage_model.onnx`: {metadata['sizeBytes']} bytes, opset {metadata['onnx']['opset']}, "
        f"input `symptoms` float32 [N, {len(data.features)}], output `probabilities` float32 [N, {n}]. "
        "The input order is `features` and the output order is `classes` in `model_metadata.json`."
    )
    w(
        "- The same two files are copied to `client/public/models/` for the PWA. A test checks that the copies match."
    )
    w(
        f"- **Parity:** sklearn vs Python onnxruntime on all training cases: max |Δp| = "
        f"{chosen['parity_max_abs_diff']:.1e}. `ai-service/models/parity_fixtures.json` stores sklearn outputs "
        f"for {settings['fixtures']} inputs (clean, noisy, empty, single symptoms). These are replayed by "
        "`ai-service/tests/test_model.py` (onnxruntime) and `client/src/model.parity.test.ts` "
        "(onnxruntime-node, the same engine family as onnxruntime-web in the browser)."
    )
    w("")
    w("## 11. Limitations")
    w("")
    w(
        f"- **Near-synthetic data.** There are {len(data.unique)} unique symptom combinations, each repeated many "
        "times. They are perfectly separable and generated from a disease-to-symptom table, not real patient "
        "records. Real-world accuracy will be lower than anything reported here."
    )
    w(
        "- **Not clinically validated: needs review by a doctor before any real use.** Neither the model nor "
        "the condition-to-triage table (`shared/data/conditions.json`: which of the 41 conditions maps to "
        "SEE_DOCTOR_24H, SEE_DOCTOR_SOON or SELF_CARE) has been reviewed by clinicians or tested "
        "prospectively. The table is the developer's judgement, made for this student project."
    )
    top3, ex_level, ex_low = dengue_example(chosen["final"], data, conditions)
    shown = ", ".join(f"{conditions.get(c).name.en} {p:.2f}" for c, p in top3)
    w(
        "- **Known confusion: dengue vs impetigo.** Skin rash is a strong impetigo symptom, so it pulls "
        "dengue-like presentations towards impetigo. Example: fever, joint pain, pain behind the eyes and skin "
        f"rash gives **{shown}**. Because the top probability is below {conditions.policy.minConfidence} "
        f"(low confidence: {'yes' if ex_low else 'no'}), and dengue (SEE_DOCTOR_24H) is the top condition, "
        f"**the policy still returns {ex_level}**. The wrong runner-up doesn't lower the level, but the "
        "possible-conditions list shown to the user includes impetigo."
    )
    w(
        "- **Not a diagnosis tool.** The output lists *possible* conditions to guide triage. "
        "Every result carries a disclaimer."
    )
    w(
        f"- **Narrow scope.** Only {n} conditions are covered. The model has no input for age, sex, duration, "
        "severity or vital signs, and a condition outside this list will be mislabelled as the nearest one."
    )
    w(
        "- **The model never decides emergencies.** Conditions such as heart attack or brain haemorrhage map to "
        "SEE_DOCTOR_24H at most. EMERGENCY comes only from the red-flag rules. Cases routed to EMERGENCY by "
        "breathlessness are deliberate over-triage."
    )
    w(
        "- **Simple noise model.** Random dropping and adding is only a rough stand-in for how people really "
        "report symptoms. It is a stress test, not a field estimate."
    )
    w("")
    w("## 12. Reproduce")
    w("")
    w("```bash")
    w("cd ai-service")
    w("pip install -r requirements-dev.txt")
    w("python -m training.fetch_dataset   # or download manually into ai-service/data/raw/")
    w("python -m training.check_dataset")
    w("python -m training.train           # writes models/, client/public/models/, this report")
    w("```")
    w("")
    (docs_dir / "MODEL_REPORT.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")
