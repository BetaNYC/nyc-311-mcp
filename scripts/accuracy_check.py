"""Accuracy check for the district tools (#14) and the Local Law 47 reports (#15): each tool's numbers against DuckDB SQL.

For the "BoardStat in Action" questions Q1, Q3, Q4, Q9, Q13 and Q17 (plus Q2), runs the
tool (dist/, through scripts/run-district-tools.mjs) and the independent DuckDB queries in
scripts/boardstat_oracle.py over the SAME local BoardStat data folder, and compares every
number. Prints a Markdown table; exits 1 on any mismatch.

    npm run build
    uv run --no-project --with "duckdb>=1.1,<3" python scripts/accuracy_check.py <boardstat-data-dir>

<boardstat-data-dir> is a BoardStat `data/` folder (a copy of what
https://www.beta.nyc/boardstat/data/ serves). It is only read. No network is used.
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from boardstat_oracle import Oracle  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def flatten(v, prefix=""):
    """{'a': [{'b': 1}]} -> {'a[0].b': 1}, so two answers can be compared value by value."""
    out = {}
    if isinstance(v, dict):
        for k, x in v.items():
            out.update(flatten(x, f"{prefix}.{k}" if prefix else k))
    elif isinstance(v, list):
        for i, x in enumerate(v):
            out.update(flatten(x, f"{prefix}[{i}]"))
    else:
        out[prefix] = v
    return out


def pick(tool: dict, oracle: dict) -> dict:
    """The tool's values at the oracle's keys (lists matched by position)."""
    def walk(t, o):
        if isinstance(o, dict):
            return {k: walk((t or {}).get(k) if isinstance(t, dict) else None, ov) for k, ov in o.items()}
        if isinstance(o, list):
            t = t if isinstance(t, list) else []
            return [walk(t[i] if i < len(t) else None, ov) for i, ov in enumerate(o)] + (
                [{"<extra rows>": len(t) - len(o)}] if len(t) > len(o) else [])
        return t
    return walk(tool, oracle)


def main() -> int:
    data_dir = Path(sys.argv[1]).resolve()
    manifest = json.loads((data_dir / "manifest.json").read_text())
    o = Oracle(data_dir, manifest)
    last = date.fromisoformat(o.last_day)
    d30 = str(last - timedelta(days=29))
    d365 = str(last - timedelta(days=364))
    fy_start = "2026-07-01"  # FY2027

    questions = [
        ("Q1", "Top problems this year vs last, Manhattan CD 1 (2026 to date)",
         {"name": "top_problems", "args": {"community_district": 101, "from_date": "2026-01-01", "limit": 10}},
         lambda: o.top_problems("cd", 101, "2026-01-01", o.last_day, 10), "data"),
        ("Q2", "District vs borough and city, Manhattan CD 1, FY2027 to date",
         {"name": "district_summary", "args": {"community_district": 101, "fiscal_year": 2027}},
         lambda: o.district_summary("cd", 101, fy_start, o.last_day, "Manhattan"), "summary"),
        ("Q3", "Agency response, Manhattan CD 1, FY2027 to date",
         {"name": "agency_response", "args": {"community_district": 101, "fiscal_year": 2027, "limit": 100}},
         lambda: o.agency_response("cd", 101, fy_start, o.last_day), "data"),
        ("Q4", "Oldest still open, Manhattan CD 1, all data",
         {"name": "still_open", "args": {"community_district": 101, "limit": 10}},
         lambda: o.still_open("cd", 101, o.win_start, o.last_day, 10), "open"),
        ("Q9", "Heat/hot water top addresses, Bronx CD 5, heat season 2025-10-01 to 2026-05-31",
         {"name": "top_addresses", "args": {"community_district": 205, "problems": ["HEAT/HOT WATER"], "from_date": "2025-10-01", "to_date": "2026-05-31", "limit": 15}},
         lambda: o.top_addresses("cd", 205, "2025-10-01", "2026-05-31", 15, types=["HEAT/HOT WATER"]), "addr"),
        ("Q13a", "Blocked bike lanes: top addresses, Brooklyn CD 1, last 365 days",
         {"name": "top_addresses", "args": {"community_district": 301, "problems": ["Illegal Parking"], "descriptions": ["Blocked Bike Lane"], "last_days": 365, "limit": 15}},
         lambda: o.top_addresses("cd", 301, d365, o.last_day, 15, types=["Illegal Parking"], descs=["Blocked Bike Lane"]), "addr"),
        ("Q13b", "Illegal parking per month, Brooklyn CD 1, last 365 days",
         {"name": "problem_trend", "args": {"community_district": 301, "problem": "Illegal Parking", "last_days": 365}},
         lambda: o.problem_trend("cd", 301, d365, o.last_day, ["Illegal Parking"]), "trend"),
        ("Q17", "Top complaints, Council District 4, last 30 days",
         {"name": "top_problems", "args": {"council_district": 4, "last_days": 30, "limit": 10}},
         lambda: o.top_problems("cc", 4, d30, o.last_day, 10), "data"),
    ]

    # Phase 2 (#15): the Local Law 47 reports, against the same oracle's ll47 queries.
    cd_all = f"read_parquet('{o.dir / 'detail' / 'cd'}/*.parquet')"
    oct_s, oct_e = "2026-10-01", "2026-10-31"

    def sr(src, lim=50):
        return {"month": o.sr_report(src, oct_s, oct_e, lim), "fiscal_year": o.sr_report(src, fy_start, oct_e, lim)}

    def cb(cd, offset, limit):
        ids = o.cb_list(cd, oct_s, oct_e)
        rows = ids["new_this_month"] + ids["unresolved_from_prior_months"] + ids["unresolved_at_month_end_now_closed"]
        return {"counts": {"new_this_month": len(ids["new_this_month"]),
                           "unresolved_from_prior_months": len(ids["unresolved_from_prior_months"]),
                           "unresolved_at_month_end_now_closed": len(ids["unresolved_at_month_end_now_closed"]), "rows": len(rows)},
                "record_problems": ids["record_problems"],
                "rows": [{"sr_number": k} for k in rows[offset:offset + limit]]}

    questions += [
        ("L1", "LL47 service request report, Manhattan CD 1, 2026-10 and FY2027 to date",
         {"name": "ll47_service_request_report", "args": {"community_district": 101, "month": "2026-10"}},
         lambda: sr(o.detail("cd", 101)), "ll47"),
        ("L2", "LL47 service request report, Council District 4, 2026-10 and FY2027 to date",
         {"name": "ll47_service_request_report", "args": {"council_district": 4, "month": "2026-10", "limit": 200}},
         lambda: sr(o.detail("cc", 4), 200), "ll47"),
        ("L3", "LL47 service request report, citywide (every district file), 2026-10 and FY2027 to date",
         {"name": "ll47_service_request_report", "args": {"month": "2026-10", "read_every_district": True, "limit": 300}},
         lambda: sr(cd_all, 300), "ll47"),
        ("L4", "LL47 service request report, citywide from the month file, 2026-10 and FY2027 to date",
         {"name": "ll47_service_request_report", "args": {"month": "2026-10", "limit": 300}},
         lambda: {"month": o.agg_report("city", None, "2026-10", "2026-10", 300),
                  "fiscal_year": o.agg_report("city", None, "2026-07", "2026-10", 300)}, "ll47"),
        ("L5", "LL47 service request report, Queens from the month file, 2026-10",
         {"name": "ll47_service_request_report", "args": {"month": "2026-10", "borough": "Queens", "limit": 300}},
         lambda: {"month": o.agg_report("borough", "Queens", "2026-10", "2026-10", 300)}, "ll47"),
        ("L6", "§ 1075(d) list, Manhattan CD 1, 2026-10, first page of 1,000",
         {"name": "cb_monthly_list", "args": {"community_district": 101, "month": "2026-10", "limit": 1000}},
         lambda: cb(101, 0, 1000), "ll47"),
        ("L7", "§ 1075(d) list, Manhattan CD 1, 2026-10, the page where new rows end and unresolved ones begin",
         {"name": "cb_monthly_list", "args": {"community_district": 101, "month": "2026-10", "offset": 3500, "limit": 1000}},
         lambda: cb(101, 3500, 1000), "ll47"),
        ("L8", "§ 1075(d) list, Bronx CD 5, 2026-09, unresolved part only",
         {"name": "cb_monthly_list", "args": {"community_district": 205, "month": "2026-09", "part": "unresolved_from_prior_months", "offset": 0, "limit": 1000}},
         lambda: (lambda ids: {"counts": {"unresolved_from_prior_months": len(ids["unresolved_from_prior_months"])},
                               "rows": [{"sr_number": k} for k in ids["unresolved_from_prior_months"][:1000]]})(o.cb_list(205, "2026-09-01", "2026-09-30")), "ll47"),
        ("L10", "§ 1075(d) list, Manhattan CD 1, 2024-03, record problems",
         {"name": "cb_monthly_list", "args": {"community_district": 101, "month": "2024-03", "limit": 1}},
         lambda: {"record_problems": o.cb_list(101, "2024-03-01", "2024-03-31")["record_problems"]}, "ll47"),
        ("L9", "§ 1075(d) list, Brooklyn CD 1, 2024-03: unresolved at month end, closed since",
         {"name": "cb_monthly_list", "args": {"community_district": 301, "month": "2024-03", "part": "unresolved_at_month_end_now_closed", "limit": 1000}},
         lambda: (lambda ids: {"counts": {"unresolved_at_month_end_now_closed": len(ids["unresolved_at_month_end_now_closed"])},
                               "record_problems": {"closed_without_close_date": ids["record_problems"]["closed_without_close_date"]},
                               "rows": [{"sr_number": k} for k in ids["unresolved_at_month_end_now_closed"][:1000]]})(o.cb_list(301, "2024-03-01", "2024-03-31")), "ll47"),
    ]

    calls = [q[2] for q in questions]
    proc = subprocess.run(
        ["node", str(ROOT / "scripts" / "run-district-tools.mjs"), str(data_dir)],
        input=json.dumps(calls), capture_output=True, text=True, check=True,
    )
    results = json.loads(proc.stdout)

    print(f"Data: BoardStat build {manifest['generated_at']}, newest request {o.lc}\n")
    print("| Q | Question | Tool | Values compared | Mismatches |")
    print("|---|---|---|---:|---:|")
    bad = 0
    details = []
    for (qid, text, call, oracle_fn, _), res in zip(questions, results):
        if not res["ok"]:
            print(f"| {qid} | {text} | `{call['name']}` | 0 | tool error |")
            details.append(f"{qid}: {res['error']}")
            bad += 1
            continue
        want = oracle_fn()
        got = pick(res["result"]["data"], want)
        fw, fg = flatten(want), flatten(got)
        keys = sorted(set(fw) | set(fg))
        miss = [k for k in keys if fw.get(k) != fg.get(k)]
        bad += len(miss)
        print(f"| {qid} | {text} | `{call['name']}` | {len(fw)} | {len(miss)} |")
        for k in miss[:10]:
            details.append(f"{qid} {k}: tool={fg.get(k)!r} sql={fw.get(k)!r}")
    if details:
        print("\nMismatches:")
        for line in details:
            print("-", line)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
