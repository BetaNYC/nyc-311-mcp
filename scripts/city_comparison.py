"""Compare the Local Law 47 rebuilds with the City's own 311 Reporting dashboards (#15).

Reads the City's numbers as captured from its Power BI dashboards (docs/city-311-reporting/
<as-of>/*.json, read with a browser; see docs/local-law-47-reports.md) and the tools' answers
for the same month, and prints Markdown tables of every difference. It changes nothing and
fixes nothing: each difference is reported, with the counts that point to its cause.

    npm run build
    echo '[{"name":"ll47_service_request_report","args":{"month":"2026-10","read_every_district":true,"limit":1000}}]' \\
      | node scripts/run-district-tools.mjs <boardstat-data-dir> > /tmp/sr.json
    node scripts/run-call-center-report.mjs '{"month":"2026-10","limit":2000}' > /tmp/da.json
    python3 scripts/city_comparison.py docs/city-311-reporting/2026-11-02 /tmp/sr.json /tmp/da.json

No network. Standard library only.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def fmt(n: int) -> str:
    return f"{n:,}"


def pct(a: int, b: int) -> str:
    return f"{(a - b) / b * 100:+.1f}%" if b else "n/a"


def main() -> int:
    city_dir, sr_path, da_path = (Path(p) for p in sys.argv[1:4])
    city_sr = json.loads((city_dir / "service-requests-october-fy2027.json").read_text())
    city_inq = json.loads((city_dir / "inquiries-october-fy2027.json").read_text())
    sr = json.loads(sr_path.read_text())[0]["result"]["data"]
    da = json.loads(da_path.read_text())["data"]

    # Service requests. Complaint types are compared without regard to case: the dashboard
    # writes "Elevator" where the open data writes "ELEVATOR", and so on.
    rows = [r for r in city_sr["rows"] if r["complaint_type"] not in ("Total", "") and r["agency"] != "Total"]
    totals = {r["agency"]: r for r in city_sr["rows"] if r["complaint_type"] == "Total"}
    grand = next(r for r in city_sr["rows"] if r["agency"] == "Total")
    city = {}
    for r in rows:
        k = (r["agency"], r["complaint_type"].lower())
        m, f = city.get(k, (0, 0))
        city[k] = (m + r["month"], f + r["fytd"])
    om = {(x["agency"], x["category"].lower()): x["requests"] for x in sr["month"]["resolution_time_by_category_and_agency"]}
    of = {(x["agency"], x["category"].lower()): x["requests"] for x in sr["fiscal_year"]["resolution_time_by_category_and_agency"]}
    if sr["month"]["resolution_time_truncated"] or sr["fiscal_year"]["resolution_time_truncated"]:
        print("WARNING: the tool's category-agency list was cut; raise limit.")
    absent = {k: v for k, v in city.items() if not om.get(k) and not of.get(k)}
    present = {k: v for k, v in city.items() if k not in absent}

    print("### Service requests, October 2026 and FY2027 to date\n")
    print("| | City dashboard | BetaNYC rebuild | Difference |")
    print("|---|---:|---:|---:|")
    print(f"| Requests, October | {fmt(grand['month'])} | {fmt(sr['month']['requests'])} | {fmt(sr['month']['requests'] - grand['month'])} ({pct(sr['month']['requests'], grand['month'])}) |")
    print(f"| Requests, FY2027 to date | {fmt(grand['fytd'])} | {fmt(sr['fiscal_year']['requests'])} | {fmt(sr['fiscal_year']['requests'] - grand['fytd'])} ({pct(sr['fiscal_year']['requests'], grand['fytd'])}) |")
    pm, pf = sum(v[0] for v in present.values()), sum(v[1] for v in present.values())
    print(f"| October, only the {len(present)} agency/type pairs both have | {fmt(pm)} | {fmt(sum(om.values()))} | {fmt(sum(om.values()) - pm)} ({pct(sum(om.values()), pm)}) |")
    print(f"| FYTD, same pairs | {fmt(pf)} | {fmt(sum(of.values()))} | {fmt(sum(of.values()) - pf)} ({pct(sum(of.values()), pf)}) |")
    print(f"| Agency/type pairs the City counts that BoardStat has none of | {len(absent)} pairs, {fmt(sum(v[0] for v in absent.values()))} in October, {fmt(sum(v[1] for v in absent.values()))} FYTD | 0 | |")
    higher = [k for k in om if om[k] > city.get(k, (0, 0))[0]]
    print(f"| Pairs where the rebuild is higher than the City | | {len(higher)} | |\n")

    print("#### By agency, October\n")
    print("| Agency | City | Rebuild | Difference |")
    print("|---|---:|---:|---:|")
    ours_ag = {a["agency"]: a["requests"] for a in sr["month"]["by_agency"]}
    for ag in sorted(set(totals) | set(ours_ag), key=lambda a: -totals.get(a, {"month": 0})["month"]):
        c = totals.get(ag, {"month": 0})["month"]
        o = ours_ag.get(ag, 0)
        print(f"| {ag} | {fmt(c)} | {fmt(o)} | {fmt(o - c)} |")

    print("\n#### The City's top 10, October and FYTD\n")
    print("| Agency | Complaint type | City month | Rebuild month | City FYTD | Rebuild FYTD |")
    print("|---|---|---:|---:|---:|---:|")
    for (a, t), (m, f) in sorted(city.items(), key=lambda kv: -kv[1][0])[:10]:
        name = next(r["complaint_type"] for r in rows if r["agency"] == a and r["complaint_type"].lower() == t)
        print(f"| {a} | {name} | {fmt(m)} | {fmt(om.get((a, t), 0))} | {fmt(f)} | {fmt(of.get((a, t), 0))} |")

    print("\n#### Largest types the City counts and BoardStat has none of (October)\n")
    print("| Agency | Complaint type | City month | City FYTD |")
    print("|---|---|---:|---:|")
    for (a, t), (m, f) in sorted(absent.items(), key=lambda kv: -kv[1][0])[:12]:
        name = next(r["complaint_type"] for r in rows if r["agency"] == a and r["complaint_type"].lower() == t)
        print(f"| {a} | {name} | {fmt(m)} | {fmt(f)} |")

    # Calls and inquiries.
    inq = {r["inquiry_name"]: r for r in city_inq["rows"]}
    g = inq.pop("Grand Total")
    print("\n### Calls and inquiries, October 2026 and FY2027 to date\n")
    print("| | City dashboard | BetaNYC rebuild (wewp-mm3p) | Difference |")
    print("|---|---:|---:|---:|")
    print(f"| Inquiries (agent-handled calls), October | {fmt(g['month'])} | {fmt(da['month']['calls'])} | {fmt(da['month']['calls'] - g['month'])} |")
    print(f"| Inquiries, FY2027 to date | {fmt(g['fytd'])} | {fmt(da['fiscal_year']['calls'])} | {fmt(da['fiscal_year']['calls'] - g['fytd'])} |")
    print(f"| All calls to 311, October | {fmt(city_inq['call_volume']['october'])} | not in the open data | |")
    dam = da["month"]["directory_assistance_topic_calls"]
    daf = da["fiscal_year"]["directory_assistance_topic_calls"]
    c_da = inq.get("Directory Assistance", {"month": 0, "fytd": 0})
    print(f"| Topic \"Directory Assistance\", October / FYTD | {fmt(c_da['month'])} / {fmt(c_da['fytd'])} | {fmt(dam)} / {fmt(daf)} | {fmt(dam - c_da['month'])} / {fmt(daf - c_da['fytd'])} |")
    ours = {c["category"].lower(): c["calls"] for c in da["month"]["by_category"]}
    city_l = {}
    for k, v in inq.items():
        city_l[k.lower()] = city_l.get(k.lower(), 0) + v["month"]
    diff = {k: (city_l.get(k, 0), ours.get(k, 0)) for k in set(city_l) | set(ours) if city_l.get(k, 0) != ours.get(k, 0)}
    if da["month"]["by_category_truncated"]:
        print("\nWARNING: the tool's topic list was cut; raise limit.")
    print(f"\nTopics whose October count differs (case ignored): {len(diff)}")
    for k, (c, o) in sorted(diff.items(), key=lambda kv: -abs(kv[1][0] - kv[1][1]))[:25]:
        print(f"- {k}: City {fmt(c)}, rebuild {fmt(o)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
