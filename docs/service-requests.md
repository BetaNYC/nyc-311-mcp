# Service requests: numbers, statuses, and lookup (Phase 3, #16)

Evidence read and calls made 2026-11-07, about 22:00 to 22:10 ET.

## The 311 number is not Open Data's `unique_key`

**Finding: they are different numbers (two matched requests, 2026-11-07), and we found no published source that links them** (checked: the `erm2-nwe9` data dictionary and the 311 API portal's operation docs, below).

| 311 Public API (`GetServiceRequest`) | NYC Open Data `erm2-nwe9` |
|---|---|
| `311-17323508`, DSNY, Snow or Ice / Sidewalk, submitted 2024-01-18T14:38:16, 180 EAST 94 STREET, Manhattan, "…issued a Notice of Violation." | `unique_key` **60061097**, same agency, problem, detail, created_date to the second, address and resolution text |
| `311-17323514`, DSNY, Snow or Ice / Sidewalk, submitted 2024-01-18T14:38:53, 165 EAST 94 STREET, "…found no violation at the location." | `unique_key` **60071726**, same again |
| `311-70999528` (`311-` + a real 2026-11-04 `unique_key`, NYPD noise, Manhattan CD 1) | HTTP 404, "SR with Number 311-70999528 wasn't found!" |

The two 311 numbers are 6 apart; their `unique_key`s are 10,629 apart, so there is no fixed
offset. The Open Data rows were found by agency and `created_date` to the second.

Documentation:

- `erm2-nwe9`'s data dictionary (Socrata metadata, `/api/views/erm2-nwe9.json`): `unique_key`
  is "Unique identifier of a Service Request (SR) in the open data set". None of its 46
  columns holds the 311 number.
- The 311 API's documentation (api-portal.nyc.gov, API `nyc-311-public-api`, operations
  `api-GetServiceRequest-get` and `api-GetServiceRequestList-post`) describes `SRNumber` as
  "Service Request number" and does not mention Open Data.

What this server does about it:

- District tools and `cb_monthly_list` name each request `unique_key` (renamed from
  `sr_number`, which wrongly implied a 311 number), with a caveat.
- `get_service_request` adds a `plain_language.about_the_number` note, and on a 404 it says that
  an 8-digit Open Data id is not a 311 number.
- **No link by number is made**: none is published, and the two checked pairs show no fixed offset. Instead, `plain_language.address_lookup`
  gives the request's street address (as the API wrote it, ZIP removed) and borough, and
  `next_step` says to call `address_history` with them. That finds the address and its
  district, not this request. A match by address and time to the second would usually find the
  row, but it is a guess, and the server does not make it.

The recorded responses are in `test/fixtures/api/service-requests-2026-11-07.json` (the ZIP
code at the end of each `FullAddress` replaced with the placeholder `99999`).

## Statuses

**The 311 API** sends `Status` as a code. Its only documentation is the 200-response text of
`GetServiceRequestList`:

| Code | Label |
|---|---|
| `614110001` | Open |
| `614110002` | In Progress |
| `614110000` | Cancel |
| `614110003` | Closed |

No response schema is published. The live responses also carried `AdditionalDetails`,
`ResolutionAction`, `ResolutionActionUpdatedDate`, and `Address` as `{ Borough, FullAddress }`.
An undocumented code is reported as undocumented (`status: null`), not guessed.

**Open Data (and so BoardStat)** writes `status` as text; its dictionary says only "Status of SR
submitted". Values seen:

| Status | Manhattan CD 1, 2020 on (BoardStat build 2026-11-07) | Citywide, created since 2026-10-01 (`erm2-nwe9`) |
|---|---:|---:|
| Closed | 186,372 | 336,682 |
| In Progress | 3,188 | 27,234 |
| Pending | 456 | 129 |
| Open | 297 | 36,253 |
| Assigned | 295 | 1,269 |
| Started | 41 | 0 |
| Unspecified | 20 | 31 |

"Cancelled" does not appear in either. A citywide count over all years timed out on the portal
and was not retried.

The City publishes no definition of any status beyond its label. The meanings
`src/service-requests.ts` `explainStatus` returns are **BetaNYC's plain-language reading, not
definitions**: every answer carries `meaning_source: "BetaNYC"` (or `status_meanings_source`),
and every meaning starts "The City does not publish a definition of this status." Each says only
the label, which agencies use it in the data checked, that BoardStat counts everything but
Closed as "not yet closed", and, for Closed, that closed does not mean fixed.

Which agencies use each status, BoardStat build of 2026-11-07, 2020 on (top agencies; "close
date" = rows that have a `closed_date` although the status is not Closed):

| Status | Manhattan CD 1 | Council District 11 (Bronx) |
|---|---|---|
| Open | 297: HPD 137, DOB 55, DEP 46, DOT 37; close date 55 | 2,672: HPD 2,213, DOB 160, DEP 138, DOT 119; close date 166 |
| In Progress | 3,188: TLC 1,156, DOHMH 803, EDC 671, DPR 147; close date 21 | 2,899: DPR 1,250, DOHMH 680, TLC 239, DSNY 193; close date 48 |
| Pending | 456: DOT 450; close date 316 | 1,073: DOT 1,054; close date 954 |
| Assigned | 295: DOT 254, DOB 26, DEP 8; close date 181 | 267: DOT 135, DOB 66, DEP 46; close date 103 |
| Started | 41: DEP 41; close date 1 | 115: DEP 115; close date 4 |
| Unspecified | 20: DSNY 18; close date 19 | 250: NYPD 212, DSNY 30; close date 247 |

A citywide breakdown by agency was attempted from `erm2-nwe9` and refused (HTTP 429), so the
meanings say "in the BoardStat districts checked", not citywide.

## `find_requests`

See [district-tools.md](district-tools.md). It is checked against DuckDB
(`Oracle.find_requests` in `scripts/boardstat_oracle.py`, expected answers in
`test/fixtures/boardstat/expected-lookup.json`, built by `test/fixtures/build_lookup_expected.py`).
