"""Runs the exported ONNX model with onnxruntime (the same file the PWA runs in the browser)."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from pydantic import BaseModel, ConfigDict

from app.model.policy import RankedCondition
from app.safety.red_flags import normalize_symptom_id

MODEL_FILE = "triage_model.onnx"
METADATA_FILE = "model_metadata.json"


class OnnxInfo(BaseModel):
    inputName: str  # noqa: N815 (JSON key)
    outputName: str  # noqa: N815
    opset: int


class ModelMetadata(BaseModel):
    """Mirrors ModelMetadataSchema in shared/src/schemas.ts (extra keys such as metrics are allowed)."""

    model_config = ConfigDict(extra="allow", frozen=True)

    modelVersion: str  # noqa: N815
    algorithm: str
    createdAt: str  # noqa: N815
    sha256: str
    sizeBytes: int  # noqa: N815
    onnx: OnnxInfo
    features: list[str]
    classes: list[str]


@dataclass(frozen=True)
class Ranking:
    ranked: list[RankedCondition]
    known_feature_count: int
    unmodelled_symptoms: list[str]


class Predictor:
    def __init__(self, model_dir: Path) -> None:
        model_dir = Path(model_dir)
        self.metadata = ModelMetadata.model_validate(
            json.loads((model_dir / METADATA_FILE).read_text(encoding="utf-8"))
        )
        model_bytes = (model_dir / MODEL_FILE).read_bytes()
        digest = hashlib.sha256(model_bytes).hexdigest()
        if digest != self.metadata.sha256:
            raise ValueError(f"{MODEL_FILE} sha256 {digest} does not match model_metadata.json")
        self._session = ort.InferenceSession(model_bytes, providers=["CPUExecutionProvider"])
        self._index = {f: i for i, f in enumerate(self.metadata.features)}

    @property
    def version(self) -> str:
        return self.metadata.modelVersion

    def vectorize(self, symptoms: Sequence[str]) -> tuple[np.ndarray, int, list[str]]:
        """Same rules as buildFeatureVector() in shared/src/model.ts."""
        vector = np.zeros((1, len(self.metadata.features)), dtype=np.float32)
        unmodelled: list[str] = []
        for sid in dict.fromkeys(normalize_symptom_id(s) for s in symptoms):
            i = self._index.get(sid)
            if i is None:
                unmodelled.append(sid)
            else:
                vector[0, i] = 1.0
        return vector, int(vector.sum()), unmodelled

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        outputs = self._session.run([self.metadata.onnx.outputName], {self.metadata.onnx.inputName: x})
        return np.asarray(outputs[0], dtype=np.float64)

    def rank(self, symptoms: Sequence[str]) -> Ranking:
        x, known, unmodelled = self.vectorize(symptoms)
        probs = self.predict_proba(x)[0]
        order = sorted(range(len(probs)), key=lambda i: (-probs[i], i))
        ranked = [RankedCondition(self.metadata.classes[i], float(probs[i])) for i in order]
        return Ranking(ranked, known, unmodelled)
