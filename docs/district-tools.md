# District tools: design (Phase 0)

Status: **groundwork only.** None of the district tools exist yet. This file records the
choices made in Phase 0 ([#13](https://github.com/BetaNYC/nyc-311-mcp/issues/13), epic
[#12](https://github.com/BetaNYC/nyc-311-mcp/issues/12)) so Phase 1
([#14](https://github.com/BetaNYC/nyc-311-mcp/issues/14)) builds on one shape.

## Where the numbers come from

The district tools read the files [BoardStat](https://www.beta.nyc/boardstat/) publishes
every night under `https://www.beta.nyc/boardstat/data/`, not the City's 311 API, so an
answer matches what a person sees on the BoardStat page and adds no load to NYC Open Data.

| File | Holds |
|---|---|
| `manifest.json` | Build time (`generated_at`), data window, sources, and `files`: every published file and its size |
| `agg/month_type.parquet` | `geo_kind`, `geo_id`, `year_month`, `complaint_type`, `n` |
| `detail/{cd,cc}/<id>.parquet` | One row per request (open requests are written last) |
| `addresses.parquet` | Every address seen, with its community and council district and a count |
| `boundaries/{cd,cc}.geojson` | District outlines |

**No ZIP codes.** BoardStat's address and detail files carry ZIP columns. The data layer
never reads them, refuses a request for one, and every answer is checked for a ZIP key
before it leaves (`assertNoZip`).

## Reading Parquet: hyparquet

All of BoardStat's Parquet files are ZSTD-compressed. Compared from each library's own
README and the npm registry, 2026-11-07:

| | hyparquet + hyparquet-compressors | @duckdb/node-api |
|---|---|---|
| Install size | about 0.85 MB in all (hyparquet 528 KB, compressors 204 KB, fzstd 80 KB, hysnappy 36 KB) | 0.7 MB plus a native binary of about 66 MB (darwin-arm64) or 69 MB (darwin-x64) |
| Native code | none; pure JavaScript plus a small embedded WASM module | yes, one prebuilt binary per platform |
| ZSTD | only with hyparquet-compressors (hyparquet's README: "By default, hyparquet supports uncompressed and snappy"); confirmed, since hyparquet alone fails on BoardStat's files with "unsupported compression codec: ZSTD" | built in |
| HTTP range reads | yes, `asyncBufferFromUrl` | yes, through the `httpfs` extension, which is fetched separately from extensions.duckdb.org |
| Node / macOS | ESM, Node's own `fs`, no platform binaries | prebuilt for macOS arm64 and x64 |

**Chosen: hyparquet with hyparquet-compressors.** It is about 1/80 of the `npx` download,
has no native binary to fail on a staff Mac, and reaches no host other than beta.nyc.
They are two npm packages from the same project, and hyparquet cannot read BoardStat's files
without the second. DuckDB stays the right tool for BoardStat's own build.

## The cache

- **Where:** `NYC_311_MCP_CACHE_DIR` if set, or the OS cache folder:
  `~/Library/Caches/nyc-311-mcp` (macOS), `$XDG_CACHE_HOME/nyc-311-mcp` or
  `~/.cache/nyc-311-mcp` (Linux), `%LOCALAPPDATA%\nyc-311-mcp\Cache` (Windows).
- **Layout:** `manifest-state.json` (the manifest and when it was checked) and
  `builds/<generated_at>/<file>`. Only the current build's folder is kept.
- **When it downloads:** a file is downloaded the first time a tool needs it, once per
  BoardStat build. `manifest.json` is asked for again at most once an hour. A newer
  `generated_at` starts a new build folder; an older one (a rollback or stale copy) is ignored.
- **Safe:** only files listed in the manifest can be fetched; each download must match the
  manifest's size or it is thrown away; files are written to a temporary name and then renamed.
- **Offline:** if beta.nyc cannot be reached, cached files still answer, and the answer
  carries a `warning` saying the data may be out of date.
- **Polite:** one request at a time, a timeout on every request, one retry on 429 or 503
  honoring `Retry-After`, and `User-Agent: @betanyc/nyc-311-mcp/<version> (+https://github.com/BetaNYC/nyc-311-mcp)`.
- **Elsewhere:** `BOARDSTAT_DATA_URL` points the server at another copy of the files (https only).
- Logs are one JSON line per event on stderr. stdout carries the MCP protocol.

## Periods: calendar dates or a fiscal year

Every district tool that takes dates accepts the same three parameters
(`PERIOD_ARG_SHAPE`, `PERIOD_JSON_PROPERTIES` in `src/fiscal-year.ts`):

| Parameter | Meaning |
|---|---|
| `from_date` | Start, YYYY-MM-DD, inclusive. Missing means the start of the data. |
| `to_date` | End, YYYY-MM-DD, inclusive. Missing means the latest data. |
| `fiscal_year` | NYC fiscal year, July 1 to June 30, named for the year it ends: `2027` or `"FY2027"` is 2026-07-01 to 2027-06-30. |

A fiscal year and calendar dates together are an error. A period reaching past the data is
cut to it, with a note in the answer's caveats (for the current fiscal year: "fiscal year to
date"). A period before 2020-01-01 is an error. `monthsInPeriod` says which months a period
covers only in part, because the month aggregate counts whole months.

## The answer envelope

Every district tool returns this shape (`districtEnvelope` in `src/envelope.ts`):

```json
{
  "data_as_of": "2026-11-07T10:36:39Z",
  "latest_request": "2026-11-04 02:05:23",
  "boardstat_url": "https://www.beta.nyc/boardstat/district.html?geo=cd&id=101&status=Open",
  "caveats": [
    "311 counts are reports, not problems: they reflect who reports and how, not only how many problems exist.",
    "\"Closed\" means the agency closed the request. It does not mean the problem was fixed.",
    "BoardStat's data starts 2020-01-01. Requests from before then are not included.",
    "Problem names are grouped by BoardStat, and those groupings have not yet been reviewed."
  ],
  "source": {
    "name": "BoardStat, by BetaNYC, built nightly from NYC Open Data",
    "url": "https://www.beta.nyc/boardstat/",
    "dataset": {
      "id": "erm2-nwe9",
      "name": "311 Service Requests from 2020 to Present",
      "url": "https://data.cityofnewyork.us/d/erm2-nwe9",
      "updated": "2026-11-07T02:37:49+00:00"
    }
  },
  "data": { "open": 4297 }
}
```

- `data_as_of` is when BoardStat built the files (manifest `generated_at`).
  `latest_request` is the newest request in them (manifest `window.last_created`); it
  trails `data_as_of` because the City publishes 311 data with a lag.
- `boardstat_url` opens the BoardStat page with the same filters. The parameter names are
  the ones BoardStat's district page reads (`geo`, `id`, `start`, `end`, `type` joined with
  `|`, `agency`, `status`). Street addresses are never put in the link, as BoardStat does.
- `caveats` always has the four above; a tool may add its own after them.
- `warning` appears only when a cached build answered because beta.nyc could not be reached.

The example `data` above is real: the 4,297 requests open in Manhattan CD 1 in the
2026-11-07 build (`scripts/boardstat-live-check.mjs`).

## Finding the district for an address

**Recommendation: BoardStat's `addresses.parquet` first.** It is the list BoardStat
itself uses, so a match finds the same requests the BoardStat page shows; it needs no key
and reaches no host but beta.nyc. Phase 0 ships the exact-match primitive
(`lookupAddress`, after BoardStat's own normalization: trimmed, spaces collapsed, upper
case). One address string can be in several boroughs, so all matches are returned.

Left for Phase 1:

- **City spelling.** The list uses the City's spelling (`5 AVENUE`, not `5th Ave`). Turning
  what people type into that spelling needs a reviewed rule set, tested on real input.
- **Addresses with no 311 history.** These are not in the list. The fallback should be the
  City's PAD file, as the address-matching work recommends, if BoardStat publishes a slim
  PAD-derived lookup next to its other files. DCP's Geoservice is not recommended as a
  default: it needs a key and sends every address someone types to a City server.
- Junk values in the list (for example `*** WEB/MAP CALL SOURCE`) should be filtered out.
