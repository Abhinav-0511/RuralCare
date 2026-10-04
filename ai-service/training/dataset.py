"""Kaggle "Disease Symptom Prediction" dataset: location, integrity checks and loading.

Source:  https://www.kaggle.com/datasets/itachi9604/disease-symptom-description-dataset
Author:  Pranay Patil (itachi9604), version 2 (2020-05-24)
License: CC BY-SA 4.0. The raw files are NOT committed; fetch them with
         `python -m training.fetch_dataset` and verify with `python -m training.check_dataset`.
"""

from __future__ import annotations

import csv
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

AI_SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AI_SERVICE_DIR.parent
DATA_DIR = AI_SERVICE_DIR / "data" / "raw"

KAGGLE_REF = "itachi9604/disease-symptom-description-dataset"
KAGGLE_VERSION = 2
KAGGLE_URL = f"https://www.kaggle.com/datasets/{KAGGLE_REF}"
KAGGLE_DOWNLOAD_URL = f"https://www.kaggle.com/api/v1/datasets/download/{KAGGLE_REF}"
LICENSE = "CC BY-SA 4.0"

# sha256 of each file in version 2 of the dataset, and the header row we rely on.
EXPECTED_FILES = {
    "dataset.csv": {
        "sha256": "ebbd391c4ba4d64f57a00eb3d0a55f0ca9b920b0c5de6b9af4234e72519c9618",
        "columns": ["Disease"] + [f"Symptom_{i}" for i in range(1, 18)],
    },
    "Symptom-severity.csv": {
        "sha256": "cb5a84b5ebde81bb18738b7e7733bcbc5abdc667b4376893fb1774d8c444bc8d",
        "columns": ["Symptom", "weight"],
    },
    "symptom_Description.csv": {
        "sha256": "e0581662e815509596707ebb5b31efb44539562b451ecef8c1246aa713b7d832",
        "columns": ["Disease", "Description"],
    },
    "symptom_precaution.csv": {
        "sha256": "49371294708232b928f68fc60e9837e5cab8b90d450b7bd90f7305795bb6d311",
        "columns": ["Disease", "Precaution_1", "Precaution_2", "Precaution_3", "Precaution_4"],
    },
}
EXPECTED_ROWS = 4920
EXPECTED_DISEASES = 41
EXPECTED_SYMPTOMS = 131


class DatasetError(Exception):
    pass


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_dataset(data_dir: Path = DATA_DIR) -> list[str]:
    """Checks every file's checksum and header. Returns human-readable OK lines; raises DatasetError."""
    report: list[str] = []
    for name, expected in EXPECTED_FILES.items():
        path = data_dir / name
        if not path.exists():
            raise DatasetError(
                f"Missing {path}. Download the dataset from {KAGGLE_URL} and unzip it into {data_dir} "
                "(or run: python -m training.fetch_dataset)."
            )
        digest = sha256_file(path)
        if digest != expected["sha256"]:
            raise DatasetError(f"{name}: sha256 {digest} does not match expected {expected['sha256']}")
        with path.open(encoding="utf-8", newline="") as f:
            header = [h.strip() for h in next(csv.reader(f))]
        if header != expected["columns"]:
            raise DatasetError(f"{name}: unexpected columns {header}")
        report.append(f"OK  {name}  sha256={digest[:16]}...  columns={len(header)}")
    return report


def normalize_symptom(raw: str) -> str:
    """'dischromic _patches' -> 'dischromic_patches', 'toxic_look_(typhos)' -> 'toxic_look_typhos'."""
    s = raw.strip().lower().replace(" ", "_")
    s = re.sub(r"[^a-z0-9_]", "", s)
    return re.sub(r"_+", "_", s).strip("_")


@dataclass(frozen=True)
class Case:
    disease: str  # dataset label, e.g. "Common Cold"
    symptoms: frozenset[str]


def load_cases(data_dir: Path = DATA_DIR) -> list[Case]:
    """All 4920 rows (with their many exact duplicates)."""
    verify_dataset(data_dir)
    with (data_dir / "dataset.csv").open(encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))[1:]
    cases = [Case(r[0].strip(), frozenset(normalize_symptom(s) for s in r[1:] if s.strip())) for r in rows]
    diseases = {c.disease for c in cases}
    symptoms = {s for c in cases for s in c.symptoms}
    if (len(cases), len(diseases), len(symptoms)) != (EXPECTED_ROWS, EXPECTED_DISEASES, EXPECTED_SYMPTOMS):
        raise DatasetError(
            f"Unexpected shape: {len(cases)} rows, {len(diseases)} diseases, {len(symptoms)} symptoms"
        )
    return cases


def unique_cases(cases: list[Case]) -> list[Case]:
    """Distinct (disease, symptom set) pairs, in first-seen order."""
    return list(dict.fromkeys(cases))
