# Service requests: numbers, statuses, and lookup (Phase 3, #16)

Evidence read and calls made 2026-11-07, about 22:00 to 22:10 ET.

## The 311 number is not Open Data's `unique_key`

**Finding: they are different numbers, and no published source links them.**

| 311 Public API (`GetServiceRequest`) | NYC Open Data `erm2-nwe9` |
|---|---|
| `311-17323508`, DSNY, Snow or Ice / Sidewalk, submitted 2024-01-18T14:38:16, 180 EAST 94 STREET, Manhattan, "…issued a Notice of Violation." | `unique_key` **60061097**, same agency, problem, detail, created_date to the second, address and resolution text |
| `311-17323514`, DSNY, Snow or Ice / Sidewalk, submitted 2024-01-18T14:38:53, 165 EAST 94 STREET, "…found no violation at the location." | `unique_key` **60071726**, same again |
| `311-70999528` (`311-` + a real 2026-11-04 `unique_key`, NYPD noise, Manhattan CD 1) | HTTP 404, "SR with Number 311-70999528 wasn't found!" |

The two 311 numbers are 6 apart; their `unique_key`s are 10,629 apart, so there is no offset
or formula either. The Open Data rows were found by agency and `created_date` to the second.

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
- **No link by number is made**, because none exists. Instead, `plain_language.address_lookup`
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

The City publishes no definition of any status beyond its label. `src/service-requests.ts`
`explainStatus` says what the label says, that BoardStat counts everything but Closed as "not yet
closed", and, for Closed, that closed does not mean fixed. What the data shows in Manhattan CD 1
was used only to word examples: Pending and Assigned are mostly DOT (whose resolution text often
says the status is on DOT's website), In Progress is mostly TLC, DOHMH and EDC, Started is DEP.

## `find_requests`

See [district-tools.md](district-tools.md). It is checked against DuckDB
(`Oracle.find_requests` in `scripts/boardstat_oracle.py`, expected answers in
`test/fixtures/boardstat/expected-lookup.json`, built by `test/fixtures/build_lookup_expected.py`).
