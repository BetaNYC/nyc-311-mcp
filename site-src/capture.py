"""Asks the built beta (dist/) one real question per demo in spec.py and saves the
answers to captures.json, which build.py checks every demo line against.

Run from the repo root after `npm run build`, with NYC_311_API_KEY set:
    python3 site-src/capture.py
captures.json is git-ignored: real answers can hold addresses. Calls run one at a
time, to be polite to the City's servers.
"""
import json, pathlib, sys, time
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from rpc import start

CALLS = [
    ("get_calendar", {}),
    ("how_to_report", {"description": "there's a pothole on my block that keeps getting bigger", "borough": "Brooklyn", "community_district": 306}),
    ("list_311_categories", {}),
    ("draft_311_report", {"description": "pothole", "location": "7th Avenue and 9th Street", "borough": "Brooklyn", "when": "since last week"}),
    ("how_to_report", {"description": "smoke pouring out of the apartment next door"}),
    ("find_district", {"address": "250 Broadway", "borough": "Manhattan"}),
    ("district_summary", {"community_district": 306, "limit": 5}),
    ("top_problems", {"community_district": 306, "last_days": 30, "limit": 5}),
    ("problem_trend", {"community_district": 306, "problem": "Noise - Residential", "last_days": 365}),
    ("agency_response", {"council_district": 39, "last_days": 90, "limit": 5}),
    ("still_open", {"community_district": 306, "limit": 5}),
    ("top_addresses", {"community_district": 306, "last_days": 90, "limit": 5}),
    ("address_history", {"address": "1 Centre Street", "borough": "Manhattan", "limit": 5}),
    ("find_requests", {"community_district": 306, "problems": ["Street Condition"], "limit": 5}),
    ("boardstat_link", {"community_district": 306, "problems": ["Noise - Residential"], "last_days": 90}),
    ("boardstat_status", {}),
    ("ll47_service_request_report", {"community_district": 306, "limit": 5}),
    ("cb_monthly_list", {"community_district": 306, "limit": 5}),
    ("get_status", {"type": "CodeBlue"}),
    ("get_service_request", {"sr_number": "311-17323508"}),
    ("ll47_directory_assistance_report", {"fiscal_year": 2026, "limit": 5}),
]

p, send, recv = start()
send({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
json.dump(recv(1)["result"]["tools"], open(HERE / "tools.json", "w"), indent=1)
out = []
for i, (name, args) in enumerate(CALLS, 10):
    t = time.time()
    send({"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": {"name": name, "arguments": args}})
    res = recv(i).get("result", {})
    out.append({"tool": name, "args": args, "isError": res.get("isError"),
                "text": res.get("content", [{}])[0].get("text", "")})
    print(name, "error" if res.get("isError") else "ok", round(time.time() - t, 1), flush=True)
json.dump(out, open(HERE / "captures.json", "w"), indent=1)
p.stdin.close()
