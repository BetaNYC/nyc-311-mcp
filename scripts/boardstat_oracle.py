"""Independent answers to the district-tool questions, in DuckDB SQL over BoardStat's Parquet.

This is the oracle the JavaScript tools are checked against. It is written from
BoardStat's own page queries (BoardStat v2/site/js/district.js: where(), renderTop,
renderMonthly, renderAgencyResponse, renderBacklog, renderAddresses, renderCompare), not
from this package's TypeScript, so a shared mistake is unlikely. Used by:

- scripts/accuracy_check.py   against a full local BoardStat data folder
- test/fixtures/build_fixtures.py   to write test/fixtures/boardstat/expected.json

Every query is read-only. Dates are New York local, as BoardStat stores them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo
from datetime import datetime

import duckdb


def lit(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def r1(v: float | None) -> float | None:
    """One decimal, as the page and the tools show days."""
    return None if v is None else float(f"{v:.1f}")


class Oracle:
    def __init__(self, data_dir: Path, manifest: dict[str, Any]):
        self.dir = Path(data_dir)
        self.m = manifest
        self.con = duckdb.connect()
        self.win_start = manifest["window"]["start"]
        self.lc = manifest["window"].get("last_created")
        last = (self.lc or manifest["window"]["end"])[:10]
        self.last_day = min(last, manifest["window"]["end"])
        gen = datetime.fromisoformat(manifest["generated_at"].replace("Z", "+00:00"))
        self.as_of = gen.astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d %H:%M:%S")

    # ------------------------------------------------------------------ helpers

    def detail(self, geo: str, gid: int) -> str:
        return f"read_parquet({lit(self.dir / 'detail' / geo / f'{gid}.parquet')})"

    def agg(self) -> str:
        return f"read_parquet({lit(self.dir / 'agg' / 'month_type.parquet')})"

    def q(self, sql: str) -> list[dict[str, Any]]:
        cur = self.con.execute(sql)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    @staticmethod
    def dates(start: str, end: str) -> str:
        return f"created_date >= CAST({lit(start)} AS DATE) AND created_date < CAST({lit(end)} AS DATE) + INTERVAL 1 DAY"

    @staticmethod
    def filters(types=None, descs=None, desc_ex=False, agency=None, status=None) -> str:
        w = ["TRUE"]
        if types:
            w.append(f"complaint_type IN ({', '.join(map(lit, types))})")
        if agency:
            w.append(f"agency = {lit(agency)}")
        if descs:
            w.append(f"coalesce(descriptor, '(none)') {'NOT IN' if desc_ex else 'IN'} ({', '.join(map(lit, descs))})")
        if status == "not_closed":
            w.append("status IS DISTINCT FROM 'Closed'")
        elif status == "closed":
            w.append("status = 'Closed'")
        return " AND ".join(w)

    def prior_bounds(self, start: str, end: str) -> str:
        """renderMonthly's prev_year bounds, the same days a year earlier."""
        eff_end = min(end, self.last_day)
        if self.lc and eff_end == self.last_day:
            end_sql = f"created_date <= CAST({lit(self.lc)} AS TIMESTAMP) - INTERVAL 12 MONTH"
        else:
            end_sql = f"created_date < CAST({lit(eff_end)} AS DATE) + INTERVAL 1 DAY - INTERVAL 12 MONTH"
        return (
            f"created_date >= CAST({lit(start)} AS DATE) - INTERVAL 12 MONTH AND {end_sql} "
            f"AND created_date >= CAST({lit(self.win_start)} AS DATE)"
        )

    CLOSED_DAYS = "CASE WHEN status = 'Closed' THEN days_to_close END"

    # ------------------------------------------------------------------ questions

    def top_problems(self, geo, gid, start, end, limit=10, agency=None, status=None) -> dict[str, Any]:
        f = self.filters(agency=agency, status=status)
        t = self.detail(geo, gid)
        rows = self.q(f"""
            SELECT complaint_type AS problem, count(*)::INTEGER AS requests, median({self.CLOSED_DAYS}) AS med
            FROM {t} WHERE {self.dates(start, end)} AND {f} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT {int(limit)}""")
        prior = {r["problem"]: r["n"] for r in self.q(
            f"SELECT complaint_type AS problem, count(*)::INTEGER AS n FROM {t} WHERE {self.prior_bounds(start, end)} AND {f} GROUP BY 1")}
        total = self.q(f"SELECT count(*)::INTEGER AS n FROM {t} WHERE {self.dates(start, end)} AND {f}")[0]["n"]
        prior_total = self.q(f"SELECT count(*)::INTEGER AS n FROM {t} WHERE {self.prior_bounds(start, end)} AND {f}")[0]["n"]
        return {
            "requests": total,
            "requests_year_earlier": prior_total,
            "problems": [
                {"problem": r["problem"], "requests": r["requests"], "median_days_to_close": r1(r["med"]),
                 "same_days_a_year_earlier": prior.get(r["problem"], 0)}
                for r in rows
            ],
        }

    def agency_response(self, geo, gid, start, end, types=None, descs=None) -> dict[str, Any]:
        f = self.filters(types=types, descs=descs)
        rows = self.q(f"""
            SELECT agency, count(*)::INTEGER AS requests,
                   count(*) FILTER (WHERE status IS DISTINCT FROM 'Closed')::INTEGER AS not_closed,
                   count(*) FILTER (WHERE status = 'Closed')::INTEGER AS closed,
                   median({self.CLOSED_DAYS}) AS med, avg({self.CLOSED_DAYS}) AS avg
            FROM {self.detail(geo, gid)} WHERE {self.dates(start, end)} AND {f} GROUP BY 1 ORDER BY 2 DESC, 1""")
        return {"agencies": [
            {"agency": r["agency"], "requests": r["requests"], "not_closed": r["not_closed"], "closed": r["closed"],
             "median_days_to_close": r1(r["med"]), "average_days_to_close": r1(r["avg"])}
            for r in rows]}

    def still_open(self, geo, gid, start, end, limit=10, types=None, agency=None) -> dict[str, Any]:
        f = self.filters(types=types, agency=agency, status="not_closed")
        t = self.detail(geo, gid)
        w = f"{self.dates(start, end)} AND {f}"
        by_agency = self.q(f"""
            SELECT agency, count(*)::INTEGER AS not_closed, strftime(min(created_date), '%Y-%m-%d') AS oldest_created
            FROM {t} WHERE {w} GROUP BY 1 ORDER BY 2 DESC, 1""")
        oldest = self.q(f"""
            SELECT unique_key AS sr_number, strftime(created_date, '%Y-%m-%d %H:%M:%S') AS created,
                   round(greatest(0, epoch(CAST({lit(self.as_of)} AS TIMESTAMP)) - epoch(created_date)) / 86400.0, 1) AS days_open
            FROM {t} WHERE {w} ORDER BY created_date, unique_key LIMIT {int(limit)}""")
        total = sum(r["not_closed"] for r in by_agency)
        return {"not_closed": total, "by_agency": by_agency,
                "oldest_first": [{**r, "days_open": float(r["days_open"])} for r in oldest]}

    def top_addresses(self, geo, gid, start, end, limit=15, types=None, descs=None, desc_ex=False, agency=None, status=None):
        f = self.filters(types=types, descs=descs, desc_ex=desc_ex, agency=agency, status=status)
        t = self.detail(geo, gid)
        rows = self.q(f"""
            SELECT address_norm AS address, count(*)::INTEGER AS requests
            FROM {t} WHERE {self.dates(start, end)} AND {f} AND address_norm IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT {int(limit)}""")
        total = self.q(f"SELECT count(*)::INTEGER AS n, count(*) FILTER (WHERE address_norm IS NULL)::INTEGER AS no_addr FROM {t} WHERE {self.dates(start, end)} AND {f}")[0]
        return {"requests": total["n"], "requests_without_street_address": total["no_addr"], "addresses": rows}

    def address_history(self, cd, addresses: list[str], start, end) -> dict[str, Any]:
        t = self.detail("cd", cd)
        w = f"{self.dates(start, end)} AND address_norm IN ({', '.join(map(lit, addresses))})"
        by = self.q(f"""
            SELECT complaint_type AS problem, count(*)::INTEGER AS requests,
                   count(*) FILTER (WHERE status IS DISTINCT FROM 'Closed')::INTEGER AS not_closed
            FROM {t} WHERE {w} GROUP BY 1 ORDER BY 2 DESC, 1""")
        newest = self.q(f"SELECT unique_key AS sr_number FROM {t} WHERE {w} ORDER BY created_date DESC, unique_key LIMIT 5")
        return {"requests": sum(r["requests"] for r in by), "by_problem": by, "newest_sr_numbers": [r["sr_number"] for r in newest]}

    def problem_trend(self, geo, gid, start, end, types, descs=None) -> dict[str, Any]:
        f = self.filters(types=types, descs=descs)
        t = self.detail(geo, gid)
        eff_end = min(end, self.last_day)
        rows = self.q(f"""
            WITH months AS (
              SELECT strftime(d, '%Y-%m') AS ym FROM range(date_trunc('month', CAST({lit(start)} AS DATE)),
                CAST({lit(eff_end)} AS DATE) + INTERVAL 1 DAY, INTERVAL 1 MONTH) AS t(d)
            ), counts AS (
              SELECT year_month AS ym, count(*)::INTEGER AS n FROM {t} WHERE {self.dates(start, end)} AND {f} GROUP BY 1
            ), prev_year AS (
              SELECT strftime(created_date + INTERVAL 12 MONTH, '%Y-%m') AS ym, count(*)::INTEGER AS n_prior
              FROM {t} WHERE {f} AND {self.prior_bounds(start, end)} GROUP BY 1
            )
            SELECT months.ym AS month, coalesce(counts.n, 0)::INTEGER AS requests, prev_year.n_prior
            FROM months LEFT JOIN counts USING (ym) LEFT JOIN prev_year USING (ym) ORDER BY 1""")
        out = []
        for r in rows:
            first = f"{r['month']}-01"
            a = max(start, first)
            prior_start = f"{int(r['month'][:4]) - 1}{r['month'][4:]}-{a[8:]}"
            covered = prior_start >= self.win_start
            out.append({"month": r["month"], "requests": r["requests"],
                        "same_days_a_year_earlier": (r["n_prior"] or 0) if covered else None})
        return {"months": out}

    def district_summary(self, geo, gid, start, end, borough) -> dict[str, Any]:
        t = self.detail(geo, gid)
        k = self.q(f"""
            SELECT count(*)::INTEGER AS n, count(*) FILTER (WHERE status IS DISTINCT FROM 'Closed')::INTEGER AS open_n,
                   median({self.CLOSED_DAYS}) AS med, avg({self.CLOSED_DAYS}) AS avg
            FROM {t} WHERE {self.dates(start, end)}""")[0]
        ym_s, ym_e = start[:7], end[:7]

        def branch(kind, gid_):
            idw = "" if gid_ is None else f" AND geo_id = {lit(gid_)}"
            return (f"SELECT geo_kind, complaint_type, n FROM {self.agg()} WHERE geo_kind = {lit(kind)}{idw} "
                    f"AND year_month BETWEEN {lit(ym_s)} AND {lit(ym_e)}")

        cmp = self.q(f"""
            WITH a AS (
              SELECT geo_kind, complaint_type AS t, sum(n) AS n FROM (
                {branch(geo, str(gid))} UNION ALL {branch('borough', borough)} UNION ALL {branch('city', None)}
              ) GROUP BY ALL
            ), s AS (SELECT geo_kind, t, n, n / sum(n) OVER (PARTITION BY geo_kind) AS share FROM a),
            top_types AS (SELECT t, n FROM s WHERE geo_kind = {lit(geo)} ORDER BY n DESC, t LIMIT 10)
            SELECT top_types.t AS problem,
              round(max(share) FILTER (WHERE geo_kind = {lit(geo)}), 4) AS district_share,
              round(max(share) FILTER (WHERE geo_kind = 'borough'), 4) AS borough_share,
              round(max(share) FILTER (WHERE geo_kind = 'city'), 4) AS city_share
            FROM top_types LEFT JOIN s USING (t) GROUP BY top_types.t, top_types.n ORDER BY top_types.n DESC, 1""")
        return {
            "requests": k["n"], "not_closed": k["open_n"],
            "median_days_to_close": r1(k["med"]), "average_days_to_close": r1(k["avg"]),
            "comparison": {"top_problems_by_share": [
                {kk: (float(v) if kk != "problem" and v is not None else v) for kk, v in r.items()} for r in cmp]},
        }

    # ------------------------------------------------------------------ Local Law 47 reports (#15)
    #
    # Written from the 2005 law's list (totals by category and agency, by resolution status,
    # average resolution time per category per agency) and BoardStat's columns, not from
    # src/ll47-reports.ts. Category = the City's complaint type (complaint_type_raw).

    def files(self, geo: str, ids: list[int]) -> str:
        paths = ", ".join(lit(self.dir / "detail" / geo / f"{i}.parquet") for i in ids)
        return f"read_parquet([{paths}])"

    def sr_report(self, src: str, start: str, end: str, limit: int = 50) -> dict[str, Any]:
        w = self.dates(start, end)
        k = self.q(f"""
            SELECT count(*)::INTEGER AS n, count(*) FILTER (WHERE status = 'Closed')::INTEGER AS closed,
                   avg({self.CLOSED_DAYS}) AS avg, median({self.CLOSED_DAYS}) AS med
            FROM {src} WHERE {w}""")[0]
        cats = self.q(f"""
            SELECT coalesce(complaint_type_raw, '(none)') AS category, count(*)::INTEGER AS requests
            FROM {src} WHERE {w} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT {int(limit)}""")
        agencies = self.q(f"""
            SELECT coalesce(agency, '(none)') AS agency, count(*)::INTEGER AS requests
            FROM {src} WHERE {w} GROUP BY 1 ORDER BY 2 DESC, 1""")
        statuses = self.q(f"""
            SELECT coalesce(status, '(none)') AS status, count(*)::INTEGER AS requests
            FROM {src} WHERE {w} GROUP BY 1 ORDER BY 2 DESC, 1""")
        rt = self.q(f"""
            SELECT coalesce(complaint_type_raw, '(none)') AS category, coalesce(agency, '(none)') AS agency,
                   count(*)::INTEGER AS requests, count(*) FILTER (WHERE status = 'Closed')::INTEGER AS closed,
                   avg({self.CLOSED_DAYS}) AS avg, median({self.CLOSED_DAYS}) AS med
            FROM {src} WHERE {w} GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2 LIMIT {int(limit)}""")
        return {
            "requests": k["n"], "closed": k["closed"], "not_closed": k["n"] - k["closed"],
            "average_days_to_close": r1(k["avg"]), "median_days_to_close": r1(k["med"]),
            "by_category": cats, "by_agency": agencies, "by_status": statuses,
            "resolution_time_by_category_and_agency": [
                {"category": r["category"], "agency": r["agency"], "requests": r["requests"], "closed": r["closed"],
                 "average_days_to_close": r1(r["avg"]), "median_days_to_close": r1(r["med"])} for r in rt],
        }

    def agg_report(self, kind: str, gid: str | None, ym_start: str, ym_end: str, limit: int = 50) -> dict[str, Any]:
        idw = "" if gid is None else f" AND geo_id = {lit(gid)}"
        w = f"geo_kind = {lit(kind)}{idw} AND year_month BETWEEN {lit(ym_start)} AND {lit(ym_end)}"
        total = self.q(f"SELECT coalesce(sum(n), 0)::BIGINT AS n FROM {self.agg()} WHERE {w}")[0]["n"]
        rows = self.q(f"""
            SELECT complaint_type AS problem, sum(n)::BIGINT AS requests FROM {self.agg()} WHERE {w}
            GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT {int(limit)}""")
        return {"requests": int(total), "by_problem": [{"problem": r["problem"], "requests": int(r["requests"])} for r in rows]}

    def cb_list(self, cd: int, month_start: str, month_end: str) -> dict[str, Any]:
        t = self.detail("cd", cd)
        fresh = self.q(f"""
            SELECT unique_key FROM {t} WHERE {self.dates(month_start, month_end)}
            ORDER BY created_date, unique_key""")
        prior = self.q(f"""
            SELECT unique_key FROM {t}
            WHERE created_date >= CAST({lit(self.win_start)} AS DATE) AND created_date < CAST({lit(month_start)} AS DATE)
              AND status IS DISTINCT FROM 'Closed'
            ORDER BY created_date, unique_key""")
        # Unresolved at the month's end, closed since: created before the month, closed after it.
        since = self.q(f"""
            SELECT unique_key FROM {t}
            WHERE created_date >= CAST({lit(self.win_start)} AS DATE) AND created_date < CAST({lit(month_start)} AS DATE)
              AND status = 'Closed' AND closed_date >= CAST({lit(month_end)} AS DATE) + INTERVAL 1 DAY
            ORDER BY created_date, unique_key""")
        prior_w = (f"created_date >= CAST({lit(self.win_start)} AS DATE) AND created_date < CAST({lit(month_start)} AS DATE)")
        no_date = self.q(f"SELECT count(*)::INTEGER AS n FROM {t} WHERE {prior_w} AND status = 'Closed' AND closed_date IS NULL")[0]["n"]
        open_dated = self.q(f"""SELECT count(*)::INTEGER AS n FROM {t} WHERE {prior_w} AND status IS DISTINCT FROM 'Closed'
            AND closed_date < CAST({lit(month_end)} AS DATE) + INTERVAL 1 DAY""")[0]["n"]
        return {"new_this_month": [r["unique_key"] for r in fresh], "unresolved_from_prior_months": [r["unique_key"] for r in prior],
                "unresolved_at_month_end_now_closed": [r["unique_key"] for r in since],
                "record_problems": {"closed_without_close_date": no_date, "not_closed_but_close_date_before_month_end": open_dated}}
