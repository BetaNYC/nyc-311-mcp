"""Expected answers for the Local Law 47 report tests (#15), from DuckDB over the fixture files.

Run once by hand, never by the tests (the tests run with no network and no DuckDB):

    uv run --no-project --with "duckdb>=2.0,<3" python test/fixtures/build_ll47_expected.py

It reads only the existing BoardStat fixtures in test/fixtures/boardstat/ (written by
build_fixtures.py) and writes test/fixtures/boardstat/expected-ll47.json, using the
queries in scripts/boardstat_oracle.py, which are written from the 2005 law's list and
BoardStat's columns, not from src/ll47-reports.ts.

"citywide" here is the two community-district fixture files (101 and 484): the tests serve
a manifest whose district list is cut to those two, so "every district file" means them.
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

    def sr(src, m_s, m_e, fy_s, lim=50):
        return {"month": o.sr_report(src, m_s, m_e, lim), "fiscal_year": o.sr_report(src, fy_s, m_e, lim)}

    def cb(cd, m_s, m_e):
        ids = o.cb_list(cd, m_s, m_e)
        return ids

    both = o.files("cd", [101, 484])
    expected = {
        "sr_484_2025_10": sr(o.detail("cd", 484), "2025-10-01", "2025-10-31", "2025-07-01"),
        "sr_484_fy2026": {"fiscal_year": o.sr_report(o.detail("cd", 484), "2025-07-01", "2026-06-30")},
        "sr_cc1_2020_01": sr(o.detail("cc", 1), "2020-01-01", "2020-01-31", "2020-01-01"),
        "sr_two_files_2026_10": sr(both, "2026-10-01", "2026-10-31", "2026-07-01", 200),
        "sr_two_files_2026_11": sr(both, "2026-11-01", o.last_day, "2026-07-01", 200),
        "agg_city_2026_10": {"month": o.agg_report("city", None, "2026-10", "2026-10"),
                             "fiscal_year": o.agg_report("city", None, "2026-07", "2026-10")},
        "agg_queens_2026_10": {"month": o.agg_report("borough", "Queens", "2026-10", "2026-10")},
        "cb_484_2025_10": cb(484, "2025-10-01", "2025-10-31"),
        "cb_101_2026_11": cb(101, "2026-11-01", o.last_day),
    }
    (FIX / "expected-ll47.json").write_text(json.dumps(expected, indent=1, default=str) + "\n")
    print({k: (v.get("month") or v.get("fiscal_year") or {}).get("requests", len(v.get("new_this_month", [])))
           for k, v in expected.items()})


if __name__ == "__main__":
    main()
