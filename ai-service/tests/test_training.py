"""Training pipeline checks. Need the raw dataset (python -m training.fetch_dataset); skipped otherwise."""

import json

import numpy as np
import pytest

from training.dataset import DATA_DIR, EXPECTED_FILES, normalize_symptom

pytestmark = pytest.mark.skipif(
    not all((DATA_DIR / name).exists() for name in EXPECTED_FILES),
    reason="raw dataset not downloaded (python -m training.fetch_dataset)",
)


@pytest.fixture(scope="module")
def setup():
    from app.model.conditions import load_conditions
    from app.safety import RedFlagEngine
    from training.dataset import load_cases
    from training.train import SHARED_DIR, build_data

    cases = load_cases()
    conditions = load_conditions(SHARED_DIR)
    return cases, build_data(cases, conditions), RedFlagEngine.from_shared_dir(SHARED_DIR)


def test_dataset_shape_and_duplication(setup) -> None:
    cases, data, _ = setup
    assert len(cases) == 4920
    assert len(data.unique) == 304
    assert len(data.features) == 131
    assert len(data.classes) == 41


def test_noisy_cases_follow_the_spec(setup) -> None:
    from training.train import make_noisy

    _, data, engine = setup
    rng = np.random.default_rng(0)
    originals = [(data.unique[i].symptoms, int(data.y[i])) for i in range(40)]
    noisy = make_noisy(originals, data, engine.red_flag_symptoms, rng, variants=5)
    assert len(noisy) == 200
    for (orig, label), (symptoms, noisy_label) in zip(
        [o for o in originals for _ in range(5)], noisy, strict=True
    ):
        assert noisy_label == label
        kept = set(symptoms) & orig
        added = set(symptoms) - orig
        assert len(kept) >= 1
        dropped = len(orig) - len(kept)
        assert dropped == 0 or 0.25 <= dropped / len(orig) <= 0.55 or len(kept) == 1
        assert 1 <= len(added) <= 2
        assert not added & data.universe[label], "added symptoms must be unrelated to the disease"
        assert not added & engine.red_flag_symptoms


def test_retrained_model_reproduces_the_committed_fixtures(setup) -> None:
    """Closes the loop sklearn -> fixtures -> onnxruntime (Python) / onnxruntime-node."""
    from training.train import AI_SERVICE_DIR, encode, logistic_regression

    _, data, _ = setup
    meta = json.loads((AI_SERVICE_DIR / "models" / "model_metadata.json").read_text(encoding="utf-8"))
    fixtures = json.loads((AI_SERVICE_DIR / "models" / "parity_fixtures.json").read_text(encoding="utf-8"))
    assert meta["features"] == data.features and meta["classes"] == data.classes

    model = logistic_regression(meta["hyperparameters"]["C"])().fit(data.x, data.y)
    x = encode([c["symptoms"] for c in fixtures["cases"]], data.features)
    got = model.predict_proba(x)
    expected = np.array([c["probabilities"] for c in fixtures["cases"]])
    # Retraining on another CPU (different BLAS kernels) stops the nearly unregularised optimiser at
    # slightly different weights (~5e-6 observed). Same model = same top-1 everywhere and probabilities
    # within 1e-3. Exact parity of the *committed* ONNX file is checked in test_model.py (1e-5).
    np.testing.assert_array_equal(got.argmax(axis=1), expected.argmax(axis=1))
    np.testing.assert_allclose(got, expected, atol=1e-3)


def test_normalize_symptom() -> None:
    assert normalize_symptom(" dischromic _patches") == "dischromic_patches"
    assert normalize_symptom("foul_smell_of urine") == "foul_smell_of_urine"
    assert normalize_symptom("toxic_look_(typhos)") == "toxic_look_typhos"
