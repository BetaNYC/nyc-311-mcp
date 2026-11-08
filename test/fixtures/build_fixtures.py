"""Build the small BoardStat fixtures the tests read, from one real BoardStat build.

Run once by hand, never by the tests (the tests run with no network and no DuckDB):

    uv run --no-project --with "duckdb>=2.0,<3" python test/fixtures/build_fixtures.py <boardstat-data-dir>

<boardstat-data-dir> is a BoardStat `data/` folder: a local copy of what
https://www.beta.nyc/boardstat/data/ serves. It is only read. The slices are written
with the same COPY options BoardStat's own build uses (`boardstat_build.py`:
FORMAT parquet, COMPRESSION zstd), so the fixtures exercise the same ZSTD codec as
the published files.

What each fixture is:

- agg/month_type.parquet   rows for city, Manhattan, cd 101, cd 484 and cc 1, 2025-07 on
- detail/cd/101.parquet    the first 150 rows plus the last 50 rows (open requests sit last)
- detail/cd/484.parquet    the real file, unchanged (the smallest district file, ~52 KB)
- addresses.parquet        200 rows from cd 101
- boundaries/{cd,cc}.geojson  one feature each (cd 101, cc 1)
- manifest.json            the real manifest, with `files` sizes rewritten to the fixtures'
"""

import json
import shutil
import sys
from pathlib import Path

import duckdb

OPTS = "(FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)"


def lit(p: Path) -> str:
    return "'" + str(p).replace("'", "''") + "'"


def main() -> None:
    src = Path(sys.argv[1]).resolve()
    out = Path(__file__).resolve().parent / "boardstat"
    for sub in ("agg", "detail/cd", "boundaries"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()

    con.execute(f"""
        COPY (SELECT * FROM read_parquet({lit(src / 'agg/month_type.parquet')})
              WHERE year_month >= '2025-07'
                AND ((geo_kind = 'city') OR (geo_kind = 'borough' AND geo_id = 'Manhattan')
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

    con.execute(f"""
        COPY (SELECT * FROM read_parquet({lit(src / 'addresses.parquet')})
              WHERE cd = 101 ORDER BY n DESC, address LIMIT 200)
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


if __name__ == "__main__":
    main()
