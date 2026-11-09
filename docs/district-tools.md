# District tools: design

Status: **the ten tools are built** (Phase 1, [#14](https://github.com/BetaNYC/nyc-311-mcp/issues/14)),
on the groundwork of Phase 0 ([#13](https://github.com/BetaNYC/nyc-311-mcp/issues/13)), epic
[#12](https://github.com/BetaNYC/nyc-311-mcp/issues/12). The Phase 1 sections are at the end:
[The ten tools](#the-ten-tools-phase-1), [How they count](#how-they-count), and
[Checking the numbers](#checking-the-numbers).

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
never reads them, refuses a request for one (as a column or as a filter key), and every answer is checked for a ZIP key
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
  BoardStat build. `manifest.json` is asked for again at most once an hour. Whatever
  `generated_at` the server publishes is the build used, newer or older: a rollback on
  BoardStat's side is followed, and its files are fetched into their own build folder.
- **A publish between checks:** if a download's size disagrees with the manifest (usually
  because BoardStat published a new build since the last check), the manifest is re-read
  at once, ignoring the hour, and the download is tried one more time.
- **Safe:** only files listed in the manifest can be fetched; each download must match the
  manifest's size or it is thrown away; files are written to a temporary name and then renamed.
- **Offline:** if beta.nyc cannot be reached, cached files still answer, and the answer
  carries a `warning` saying the data may be out of date. After a failed check, the
  network is not tried again for 5 minutes, so each question does not wait on a timeout.
- **Polite:** one request at a time, a timeout on every request (15 s for the manifest; for
  files, 30 s with no bytes arriving, so a large file on a slow link still completes), one retry on 429 or 503
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
| `fiscal_year` | NYC fiscal year, July 1 to June 30, named for the year it ends: `2027`, `"FY2027"` or `"FY27"` is 2026-07-01 to 2027-06-30. |

A fiscal year and calendar dates together are an error. A period that starts before
2020-01-01 is cut to start there, and one that runs past the newest data is cut to end there,
each with a note in the answer's caveats (for the current fiscal year: "fiscal year to
date"). Only a period that ends before 2020-01-01, or starts after the newest data, is an
error. Tools pass `dataWindow(manifest)` as the window, which ends on the day of the newest
request (`window.last_created`), not the build date, so "to date" means what the data holds. `monthsInPeriod` says which months a period
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

**City spelling (Phase 1).** Trailing city, borough and state words, and ZIP codes, are
dropped whether or not a comma comes first ("350 5th Ave New York NY 10118",
"350 5th Ave Manhattan"). They are matched only at the end, so `QUEENS BOULEVARD` and
`NEW YORK AVENUE` keep them. A borough named there narrows the match, unless nothing is in
that borough. "New York" or "NY, NY" as the city counts as Manhattan, its postal name, unless
a borough is also named; "New York City" and "NYC" mean all five boroughs. Then: `src/address-spelling.ts` ports BoardStat's own address
search (`v2/site/js/index.js`, `normalizeAddress`), so this server and the BoardStat page find
the same addresses: upper case, periods removed, everything after the first comma dropped, a
trailing ZIP code dropped and never used, ordinal endings dropped (`5TH` to `5`), `E/W/N/S`
after the house number spelled out, and the street-type word expanded only as the last word
(`AVE` to `AVENUE`; `ST NICHOLAS AVENUE` keeps its `ST`). One addition comes from the data
itself: most numbered streets are digits (`1000 5 AVENUE`), but some buildings are written
with the word (`1295 FIFTH AVENUE`), and some both ways (`350 5 AVENUE` and
`350 FIFTH AVENUE`). Numbered streets from FIRST to TWELFTH are tried both ways, and the answer
lists each spelling found. Aliases (`AVENUE OF THE AMERICAS` = `6 AVENUE`) are not attempted.
An address with no street left once a ZIP code or city is set aside (only a house
number, as in the City's junk value `730 11363`) is refused rather than looked up.
When nothing matches, the answer says so and suggests City spellings with the same house
number and street initial, skipping placeholders such as `-999 …` and `*** …`.

Still open:

- **Addresses with no 311 history.** These are not in the list. The fallback should be the
  City's PAD file, as the address-matching work recommends, if BoardStat publishes a slim
  PAD-derived lookup next to its other files. DCP's Geoservice is not recommended as a
  default: it needs a key and sends every address someone types to a City server.
- `top_addresses` keeps placeholder addresses, as the BoardStat page does, and marks them
  `placeholder_address: true`.

## The tools (Phase 1, plus `find_requests` from Phase 3)

| Tool | Reads | Default dates |
|---|---|---|
| `find_district` | `addresses.parquet` | none |
| `district_summary` | the district's detail file; `agg/month_type.parquet` for the comparison | BoardStat's opening view |
| `top_problems` | detail file (the period, and the same days a year earlier) | opening view |
| `problem_trend` | detail file | opening view |
| `agency_response` | detail file | opening view |
| `still_open` | detail file, open rows only (they sit at the end of the file) | all data, 2020 on |
| `top_addresses` | detail file | opening view |
| `address_history` | `addresses.parquet`, then the address's community district file | all data |
| `find_requests` (#16) | detail file | opening view |

**One address, two districts.** BoardStat places each request by its own point, so an
address can straddle a district line (`1501 UNDERCLIFF AVENUE`, Bronx: 4,025 requests in
CD 5, 1 in CD 4, in the BoardStat build of 2026-11-07T10:36:39Z). `address_history` uses the district with the most requests, names the
others with their exact counts in a caveat, and takes `community_district` to choose
another.

**One build per answer.** Each tool call pins one manifest (`BoardStatData.pinned()`), so
an answer never mixes two nightly builds. If BoardStat publishes a new build while a call is
reading, the call fails and says to ask again, rather than combining the two.

**Cost.** Every number comes from the district's detail file, as on the page. Measured on
the BoardStat build of 2026-11-07T10:36:39Z (Node 26, macOS arm64): a question over all the
data (2020 on) for the largest district, Council District 11 (940,801 requests), takes 1 to 2 seconds and peaks at about 700 MB of memory. A one-year question
there peaks at about 330 MB. The descriptor column is read only when a description filter
needs it.
| `boardstat_link` | the manifest; the month file to check problem names | the page's own default |
| `boardstat_status` | the manifest | none |

"Opening view" is what `district.html` shows with no dates in the link: manifest
`window.default_start` to the newest request. Every period is cut to `dataWindow` (the newest
request's day, not the build date).

**Districts.** `community_district` uses BoardStat's ids: borough digit (1 Manhattan,
2 Bronx, 3 Brooklyn, 4 Queens, 5 Staten Island) times 100 plus the district number. Joint
Interest Areas, the parks and other areas outside every community district, have their own
ids (164, 226 to 228, 355, 356, 480 to 484, 595) and are labeled as such. `council_district`
is 1 to 51. A council district's borough, for the comparison, is the one where most of its
requests are, as on the page.

**Filters.** `problems` are BoardStat's grouped problem names, matched without regard to
case and checked against the month file. `descriptions` are the 311 descriptor, matched the
same way against the requests read (a missing one is `(none)`); `exclude_descriptions`
inverts them. A blocked bike lane is a description, `Blocked Bike Lane`, under
`Illegal Parking`. `status` is `closed` or `not_closed` (every other status, BoardStat's
"Not yet closed"). `find_requests` also takes `statuses`, the City's own values (Closed,
Open, In Progress, Pending, Assigned, Started, Unspecified), matched without regard to case
against the requests read; a value no request has is refused with the values present. With
exactly one, the BoardStat link carries it (`district.js` filters `status = '<value>'`); with
several, the link carries none and a caveat says so.

**Lists** take a `limit` and say `truncated: true` when rows were left out. `find_requests`,
`address_history` and `cb_monthly_list` also page: they return `next_page` (`offset` and
`data_as_of`), and a page asked for with a `data_as_of` that is not the current build is
refused, so a list is never stitched from two builds. `find_requests` refuses a `status` and
`statuses` that cannot both hold (for example `closed` with `Pending`).

**`find_requests` memory.** It reads the district's file one 51,200-row window at a time (the
row-group size BoardStat writes), keeping counts and only the newest `offset + limit` rows,
then reads the text columns (resolution, address, description, close date) for the page alone.
Council District 11, 2020 on, `limit: 1`: about 1.06 GB peak before this, 344 MB after; a
200-row page of DOT Pending requests spread over 2020 to 2026, 516 MB (BoardStat build of
2026-11-07, Node 26, macOS arm64). When `agency`, `descriptions` or `statuses` is given, a first
light pass finds the City's exact spellings, as the other tools match them.

**Request ids.** Every list names a request by `unique_key`, NYC Open Data's id. It is not
the 311 number (`311-XXXXXXXX`) a person is given when they report, and the 311 API cannot
look it up (renamed from `sr_number` in Phase 3; [service-requests.md](service-requests.md)).
Lists that show statuses also return `status_meanings` (or `by_status` with a `meaning`).

**Why `find_requests` is a new tool.** `still_open` lists only requests not yet closed, and
`address_history` only one address. No tool listed a district's closed requests, or one
status such as `Pending`, with the agency's resolution. `find_requests` is district-only;
for an address, `address_history` stays the tool (it gained `offset` rather than a twin).

## How they count

Each rule is BoardStat's, from `v2/site/js/district.js`, so the numbers are the page's:

- In the period: `created_date >= start AND created_date < end + 1 day` (`where()`), New
  York local time.
- Not yet closed: `status IS DISTINCT FROM 'Closed'`.
- Days to close: only requests marked Closed, and only where the build kept a usable time
  (`CLOSED_DAYS`); medians are DuckDB's `median()`; shown with one decimal.
- The same days a year earlier: the same filters with the dates moved back 12 months, the day
  clamped as DuckDB's `INTERVAL` does; when the period reaches the newest data it stops at the
  same minute a year earlier (`renderMonthly`). No comparison when that reaches before 2020.
- Percent change (`top_problems`): shown only when the year-earlier count is 30 or more
  (`SMALL_BASE`). Below that the two counts and `change` are still shown, with `change_note`
  "small numbers; percent change not shown", because a small base makes a big percent that
  means little (21 to 2,712 is "+12,814%", usually a City category that is new or renamed).
  30 is BetaNYC's rule of thumb, not a City rule.
- With a `status` filter there is no year-earlier comparison (`top_problems` and
  `problem_trend`). The data has each request's status today, not its history, so "open a year
  ago" cannot be rebuilt; open-now against year-old requests that are open now compares a
  week of open requests with a year of closing (the beta test saw "+18,100%"). The answer says
  so in its caveats. Decided 2026-11-08.
- Days open: to the build time in New York local time.
- Comparison with borough and city: whole months from the month file, shares of located
  requests, top 10 by the district's count (`renderCompare`).
- Top addresses: requests with a street address, by `address_norm`, most first, ties by
  address (`renderAddresses`). The most common problem breaks ties by name.
- Ties are broken in plain character order, as DuckDB sorts text, not in locale order.

**Links.** `boardstat_url` uses only the parameters `district.js` `readState()` reads: `geo`,
`id`, `start`, `end`, `type`, `desc`, `descx`, `agency`, `status`. Addresses are never put in
a link (Phase 0 decision). BoardStat's own home-page search does open `address.html` with
`addr=` in the URL (`index.js` `addressUrl`); `address_history` links the district page
instead and says how to reach the address page.

## Checking the numbers

`scripts/accuracy_check.py` runs the tools (through `scripts/run-district-tools.mjs`) and
independent DuckDB SQL (`scripts/boardstat_oracle.py`, written from the page's queries, not
from this package's code) over the same local BoardStat data folder, and compares every value:

    npm run build
    uv run --no-project --with "duckdb>=1.1,<3" python scripts/accuracy_check.py <boardstat-data-dir>

The unit tests do the same with no network: `test/fixtures/build_fixtures.py` writes
`expected.json` with the oracle over the fixture files, and `test/district-tools.test.mjs`
checks the tools against it.
