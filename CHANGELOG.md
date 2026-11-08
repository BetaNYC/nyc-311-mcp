# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added: the three Local Law 47 of 2005 reports (Phase 2, #15)

- `ll47_service_request_report` (former Charter § 1075(b)), `ll47_directory_assistance_report`
  (former § 1075(c)) and `cb_monthly_list` (§ 1075(d), current law). Each answer carries the
  Phase 0 envelope plus a `mandate` block: the section, current or repealed (Local Law 69 of
  2023), "not the City's official report", and what is left out (ZIP codes, by decision;
  anything before 2020-01-01).
- Inputs are a calendar `month` (the answer adds its fiscal year to date) or a `fiscal_year`.
- Citywide and borough service-request answers come from BoardStat's month file unless
  `read_every_district: true`, which reads every community district file (about 860 MB).
- `src/soda.ts`: a polite client for NYC Open Data (one request at a time, 2 s apart, 429 and
  Retry-After handling, optional `SOCRATA_APP_TOKEN`), used only for `wewp-mm3p`.
- `scripts/accuracy_check.py` checks the new reports against DuckDB too (L1 to L8);
  `scripts/run-call-center-report.mjs` runs the call-center report live and records fixtures.
- Several helpers in `district-tools.ts` are now exported for reuse; their behavior is unchanged.

### Added: ten district tools (Phase 1, #14; closes #11)

- `find_district`, `district_summary`, `top_problems`, `problem_trend`, `agency_response`,
  `still_open`, `top_addresses`, `address_history`, `boardstat_link`, `boardstat_status`.
  They read BoardStat's nightly files and count exactly as BoardStat's district page does;
  `scripts/accuracy_check.py` compares every number with independent DuckDB SQL.
- `find_district` / `address_history` convert a typed address to the City's spelling with
  BoardStat's own rules (`src/address-spelling.ts`), plus digits-or-word for numbered
  streets (`5 AVENUE` / `FIFTH AVENUE`). ZIP codes are dropped and never used.
- Dates also accept `last_days` (the last N days of data, ending on the newest request).
- `boardstat_url` can carry descriptions (`desc`, `descx`); an answer served from the
  cache while beta.nyc is unreachable now says so with `stale: true` and a caveat.

### Fixed (QA round 1 on #20)

- Parallel tool calls on a cold cache no longer race on `manifest-state.json` (ENOENT on
  rename, seen in CI on Node 20 and 22): one manifest refresh is shared, and each state
  write uses its own temporary name.
- Five-digit numbers that look like ZIP codes in free text (agency resolution text, City
  addresses) are removed before an answer leaves, and every string in an answer is checked
  for one. A lookup left with only a house number is refused, and "New York" or "NY, NY"
  after the street is read as Manhattan.
- `find_district` / `address_history` accept a city, borough, state or ZIP after the street
  without a comma; a named borough narrows the match.
- `address_history` no longer stops when one address straddles two districts: it uses the
  district with the most requests, names the other, and accepts `community_district`.
- One tool call reads one BoardStat build (`BoardStatData.pinned()`).
- Ties sort in plain character order, as DuckDB and the BoardStat page do.

### Fixed (Phase 0 follow-up, QA round 2 on #19)

- A newer build arriving during a download or read no longer deletes the folder in use
  (it failed with ENOENT); the old folder is removed when the last use ends.
- A download from a server that ignores the abort signal no longer hangs: the idle
  timeout now also ends the stream.

### Phase 0

Groundwork for the district tools (epic #12, Phase 0 #13). No new tools yet, and
nothing a client sees has changed: tool names, descriptions and schemas are the same.

### Added

- `src/boardstat-data.ts`: reads BoardStat's published files
  (`https://www.beta.nyc/boardstat/data/`) and caches them on disk until BoardStat
  publishes a newer build. One request at a time, timeouts, a package User-Agent.
  ZIP code columns are never read. Not yet used by any tool.
- `src/fiscal-year.ts`: NYC fiscal year (July 1 to June 30) and calendar-period
  handling shared by future date tools.
- `src/envelope.ts`: the answer shape every district tool will share
  (`data_as_of`, `boardstat_url`, `caveats`, `source`). See `docs/district-tools.md`.
- Dependencies: `hyparquet` and `hyparquet-compressors` (pure-JavaScript Parquet
  reader and its ZSTD codec; about 0.85 MB installed).
- Tests for all of the above, run with no network against small slices of a real
  BoardStat build (`test/fixtures/boardstat/`).

### Changed

- CI tests Node 18 again (alongside 20 and 22), to back `engines.node >= 18`.
- The server reports its real version (from `package.json`) instead of a hard-coded `1.0.0`.
- Cleanup from PR #3 (#9): one `apiFetch` helper instead of `apiGet`/`apiPost`/`buildUrl`,
  no `STATUS_PATHS` table, the unused calendar response types removed, and a shorter
  `get_calendar` date fallback. A new test pins every request sent to the 311 API; it
  passed before and after the change.

### Tests

- Every tool is now tested to reject an unknown parameter (#7), and a tool added later
  without a test entry fails the suite.

## [1.1.0] — 2026-07-21

### Fixed

- Tool schemas are strict. Unknown parameters are now rejected with a message
  naming the offending key and the parameters the tool does accept, instead of
  being silently dropped and answering with unfiltered results (#7).

### Changed

- Tool definitions and dispatch moved from `src/index.ts` to `src/tools.ts`,
  exported as `TOOLS` and `callTool`, so they can be tested without starting
  the stdio server. No change to the wire interface.

## [1.0.1] — 2026-07-06

### Fixed

- `get_calendar` no-arg "today" now computed in America/New_York instead of
  UTC, so evening queries no longer return tomorrow's calendar (PR #4).
- API error messages now include the response body (truncated to 500 chars);
  401s add explicit `NYC_311_API_KEY` guidance (PR #4).
- One bounded retry on HTTP 429, honoring `Retry-After` (PR #4).
- Service-request numbers validated against `311-\d+` with a corrective
  error message (PR #4).

### Added

- Tag-triggered npm release automation (`.github/workflows/release.yml`)
  and this changelog.
- Build-only CI workflow on Node 20/22 (#2).

### Changed

- README: dedicated API-key subsection (#1).

## [1.0.0] — 2026-06-22

Initial release, published to npm as
[`@betanyc/nyc-311-mcp`](https://www.npmjs.com/package/@betanyc/nyc-311-mcp).

### Added

- MCP server for the NYC 311 Public API with four tools: `get_calendar`
  (city-services calendar: alternate-side parking, collections, schools),
  `get_status` / emergency and weather status alerts, `get_service_request`,
  and `get_service_request_list`.

[Unreleased]: https://github.com/BetaNYC/nyc-311-mcp/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/BetaNYC/nyc-311-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/BetaNYC/nyc-311-mcp/releases/tag/v1.0.0
