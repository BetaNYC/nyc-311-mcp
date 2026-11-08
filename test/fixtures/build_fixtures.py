"""Build the small BoardStat fixtures the tests read, from one real BoardStat build.

Run once by hand, never by the tests (the tests run with no network and no DuckDB):

    uv run --no-project --with "duckdb>=2.0,<3" python test/fixtures/build_fixtures.py <boardstat-data-dir>

<boardstat-data-dir> is a BoardStat `data/` folder: a local copy of what
https://www.beta.nyc/boardstat/data/ serves. It is only read. The slices are written
with the same COPY options BoardStat's own build uses (`boardstat_build.py`:
FORMAT parquet, COMPRESSION zstd), so the fixtures exercise the same ZSTD codec as
the published files.

What each fixture is:

- agg/month_type.parquet   rows for city, Manhattan, Queens, cd 101, cd 484 and cc 1, 2025-07 on
- detail/cd/101.parquet    the first 150 rows plus the last 50 rows (open requests sit last)
- detail/cd/484.parquet    the real file, unchanged (the smallest district file, ~52 KB)
- detail/cc/1.parquet      the first 150 rows plus the last 50 rows (Phase 1)
- detail/cd/102.parquet    only the requests at GREENWICH STREET, which straddles cd 101
                           and cd 102 (Phase 1, address_history)
- addresses.parquet        200 rows from cd 101, then the cd 484 addresses and a few
                           spelling cases for find_district (Phase 1), sorted by address
                           within each part so the cd 101 rows stay first
- expected.json            the district-tool answers for cd 484, computed by DuckDB with
                           scripts/boardstat_oracle.py over these fixture files (Phase 1)
- boundaries/{cd,cc}.geojson  one feature each (cd 101, cc 1)
- manifest.json            the real manifest, with `files` sizes rewritten to the fixtures'
"""

import json
import shutil
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from boardstat_oracle import Oracle  # noqa: E402

# Spelling cases for find_district: the same building written two ways, an ST that
# means SAINT, and a word ordinal (2026-11-07 build).
SPELLING_CASES = ("350 5 AVENUE", "350 FIFTH AVENUE", "76 ST NICHOLAS PLACE", "1530 WEST EIGHTH STREET", "1000 5 AVENUE",
                  "1501 UNDERCLIFF AVENUE", "10001 4 AVENUE")
# An address that straddles a district line: more requests in cd 101 than cd 102.
STRADDLE = "GREENWICH STREET"

OPTS = "(FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)"


def lit(p: Path) -> str:
    return "'" + str(p).replace("'", "''") + "'"


def main() -> None:
    src = Path(sys.argv[1]).resolve()
    out = Path(__file__).resolve().parent / "boardstat"
    for sub in ("agg", "detail/cd", "detail/cc", "boundaries"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()

    con.execute(f"""
        COPY (SELECT * FROM read_parquet({lit(src / 'agg/month_type.parquet')})
              WHERE year_month >= '2025-07'
                AND ((geo_kind = 'city') OR (geo_kind = 'borough' AND geo_id IN ('Manhattan', 'Queens'))
                     OR (geo_kind = 'cd' AND geo_id IN ('101', '484'))
                     OR (geo_kind = 'cc' AND geo_id = '1'))
              ORDER BY geo_kind, geo_id, year_month, complaint_type)
        TO {lit(out / 'agg/month_type.parquet')} {OPTS}""")

    d101 = lit(src / "detail/cd/101.parquet")
    con.execute(f"""
        COPY (SELECT * EXCLUDE (file_row_number)
              FROM read_parquet({d101}, file_row_number = true)
              WHERE file_row_number < 150
                 OR file_row_number >= (SELECT count(*) FROM read_parquet({d101})) - 50
              ORDER BY file_row_number)
        TO {lit(out / 'detail/cd/101.parquet')} {OPTS}""")

    shutil.copyfile(src / "detail/cd/484.parquet", out / "detail/cd/484.parquet")

    c1 = lit(src / "detail/cc/1.parquet")
    con.execute(f"""
        COPY (SELECT * EXCLUDE (file_row_number)
              FROM read_parquet({c1}, file_row_number = true)
              WHERE file_row_number < 150
                 OR file_row_number >= (SELECT count(*) FROM read_parquet({c1})) - 50
              ORDER BY file_row_number)
        TO {lit(out / 'detail/cc/1.parquet')} {OPTS}""")

    con.execute(f"""
        COPY (SELECT * FROM read_parquet({lit(src / 'detail/cd/102.parquet')}) WHERE address_norm = {lit(STRADDLE)}
              ORDER BY is_closed DESC, created_date, unique_key)
        TO {lit(out / 'detail/cd/102.parquet')} {OPTS}""")

    addr = lit(src / "addresses.parquet")
    cases = ", ".join(lit(a) for a in (*SPELLING_CASES, STRADDLE))
    con.execute(f"""
        COPY (
          SELECT * EXCLUDE (part) FROM (
            (SELECT *, 0 AS part FROM read_parquet({addr}) WHERE cd = 101 ORDER BY n DESC, address LIMIT 200)
            UNION ALL
            SELECT *, 1 AS part FROM read_parquet({addr})
            WHERE (cd = 484 OR address IN ({cases}))
              AND NOT (cd = 101 AND address IN (SELECT address FROM read_parquet({addr}) WHERE cd = 101 ORDER BY n DESC, address LIMIT 200))
          ) ORDER BY part, CASE WHEN part = 0 THEN -n END, address)
        TO {lit(out / 'addresses.parquet')} {OPTS}""")

    for kind, keep in (("cd", 101), ("cc", 1)):
        g = json.loads((src / f"boundaries/{kind}.geojson").read_text())
        g["features"] = [f for f in g["features"] if f["properties"]["id"] == keep]
        (out / f"boundaries/{kind}.geojson").write_text(json.dumps(g))

    manifest = json.loads((src / "manifest.json").read_text())
    manifest["files"] = {
        str(p.relative_to(out)): p.stat().st_size
        for p in sorted(out.rglob("*"))
        if p.is_file() and p.name != "manifest.json"
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(json.dumps(manifest["files"], indent=1))

    # The answers the unit tests expect, from DuckDB over the fixture files themselves.
    o = Oracle(out, manifest)
    last = o.last_day
    top_addr = o.q(f"SELECT address_norm AS a FROM {o.detail('cd', 484)} WHERE address_norm IS NOT NULL "
                   "GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1")[0]["a"]
    expected = {
        "last_day": last,
        "top_problems_all": o.top_problems("cd", 484, "2021-01-01", last, 10),
        "top_problems_fy2026": o.top_problems("cd", 484, "2025-07-01", "2026-06-30", 5),
        "agency_response_all": o.agency_response("cd", 484, o.win_start, last),
        "still_open_all": o.still_open("cd", 484, o.win_start, last, 5),
        "top_addresses_all": o.top_addresses("cd", 484, o.win_start, last, 5),
        "problem_trend_noise": o.problem_trend("cd", 484, "2025-07-01", last, ["Noise - Street/Sidewalk"]),
        "district_summary_fy2027": o.district_summary("cd", 484, "2026-07-01", last, "Queens"),
        "address_history_top": {"address": top_addr, **o.address_history(484, [top_addr], o.win_start, last)},
        "address_history_straddle": {
            "address": STRADDLE,
            "chosen": {"cd": 101, **o.address_history(101, [STRADDLE], o.win_start, last)},
            "other": {"cd": 102, **o.address_history(102, [STRADDLE], o.win_start, last)},
        },
    }
    (out / "expected.json").write_text(json.dumps(expected, indent=1, default=str) + "\n")


if __name__ == "__main__":
    main()
