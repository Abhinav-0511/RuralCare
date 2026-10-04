"""Verify the raw dataset files: checksums, column names and shape.

Usage (from ai-service/):  python -m training.check_dataset [data_dir]
Exit code 0 = OK, 1 = missing or modified files.
"""

import sys
from pathlib import Path

from training.dataset import DATA_DIR, DatasetError, load_cases, unique_cases, verify_dataset


def main() -> int:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DATA_DIR
    try:
        for line in verify_dataset(data_dir):
            print(line)
        cases = load_cases(data_dir)
    except DatasetError as e:
        print(f"FAIL  {e}", file=sys.stderr)
        return 1
    print(
        f"OK  {len(cases)} rows, {len({c.disease for c in cases})} diseases, "
        f"{len({s for c in cases for s in c.symptoms})} symptoms, {len(unique_cases(cases))} unique cases"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
