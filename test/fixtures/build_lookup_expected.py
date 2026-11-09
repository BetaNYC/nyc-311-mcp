"""Expected answers for the find_requests tests (#16), from DuckDB over the fixture files.

Run once by hand, never by the tests (the tests run with no network and no DuckDB):

    uv run --no-project --with "duckdb>=2.0,<3" python test/fixtures/build_lookup_expected.py

It reads only the existing BoardStat fixtures in test/fixtures/boardstat/ (written by
build_fixtures.py) and writes test/fixtures/boardstat/expected-lookup.json, using
Oracle.find_requests in scripts/boardstat_oracle.py, which is SQL over BoardStat's columns,
not a port of src/district-tools.ts.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from boardstat_oracle import Oracle  # noqa: E402

FIX = Path(__file__).resolve().parent / "boardstat"


def main() -> None:
    manifest = json.loads((FIX / "manifest.json").read_text())
    o = Oracle(FIX, manifest)
    start, last = o.win_start, o.last_day
    expected = {
        "all_484": o.find_requests("cd", 484, start, last, limit=10),
        "all_484_page2": o.find_requests("cd", 484, start, last, limit=10, offset=10),
        "pending_484": o.find_requests("cd", 484, start, last, limit=200, statuses=["Pending"]),
        "closed_dot_484_fy2026": o.find_requests("cd", 484, "2025-07-01", "2026-06-30", limit=5, status="closed", agency="DOT"),
        "not_closed_cc1": o.find_requests("cc", 1, start, last, limit=50, status="not_closed"),
    }
    (FIX / "expected-lookup.json").write_text(json.dumps(expected, indent=1, default=str) + "\n")
    print({k: v["requests"] for k, v in expected.items()})


if __name__ == "__main__":
    main()
