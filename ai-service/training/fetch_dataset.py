"""Download the dataset from Kaggle's public API into ai-service/data/raw and verify it.

Usage (from ai-service/):  python -m training.fetch_dataset

Kaggle currently serves this public dataset without credentials. If that changes, download it
manually from the URL below and unzip the four CSV files into ai-service/data/raw/.
"""

import io
import sys
import urllib.request
import zipfile

from training.dataset import (
    DATA_DIR,
    EXPECTED_FILES,
    KAGGLE_DOWNLOAD_URL,
    KAGGLE_URL,
    DatasetError,
    verify_dataset,
)


def main() -> int:
    print(f"Downloading {KAGGLE_DOWNLOAD_URL}")
    try:
        with urllib.request.urlopen(KAGGLE_DOWNLOAD_URL, timeout=60) as res:
            payload = res.read()
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except Exception as e:  # noqa: BLE001 - report any download/zip problem the same way
        print(
            f"Download failed ({e}).\nDownload it manually from {KAGGLE_URL} and unzip the CSV files into {DATA_DIR}",
            file=sys.stderr,
        )
        return 1

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name in EXPECTED_FILES:
        (DATA_DIR / name).write_bytes(archive.read(name))
    try:
        for line in verify_dataset(DATA_DIR):
            print(line)
    except DatasetError as e:
        print(f"FAIL  {e}", file=sys.stderr)
        return 1
    print(f"Saved to {DATA_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
