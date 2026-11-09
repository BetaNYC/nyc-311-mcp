# The Local Law 47 of 2005 reports: design and checks

Status: **built** (Phase 2, [#15](https://github.com/BetaNYC/nyc-311-mcp/issues/15)), epic
[#12](https://github.com/BetaNYC/nyc-311-mcp/issues/12). The tools reuse the Phase 0 and 1
modules (`boardstat-data.ts`, `fiscal-year.ts`, `envelope.ts`, `district-tools.ts`); the code is
`src/ll47-reports.ts` and, for NYC Open Data, `src/soda.ts`.

**These are BetaNYC rebuilds from NYC Open Data, not the City's official reports. Only the City
can meet Charter § 1075.**

## The law

[Local Law 47 of 2005](https://intro.nyc/0174-2004) (Int 0174-2004, Gale A. Brewer; signed
2005-05-19) created Charter § 1075 and three monthly reports, "since April 1, 2004":

| Tool | Section | Status | What the law asked for |
|---|---|---|---|
| `ll47_service_request_report` | § 1075(b) | Repealed by [Local Law 69 of 2023](https://intro.nyc/1004-2023) § 4 ("b. Reserved.") | Requests for service "disaggregated on a month-by-month and fiscal year-by-year basis": totals by category and agency; totals by resolution status; "the average resolution time for each request for service category by the agency"; "citywide and disaggregated by zip code, community district, council district and borough" |
| `ll47_directory_assistance_report` | § 1075(c) | Repealed by Local Law 69 of 2023 § 4 ("c. Reserved.") | The same for directory assistance calls, by category and agency |
| `cb_monthly_list` | § 1075(d) | **Current law** | To each community board, within seven business days of each month's end: every request "identified to have occurred in the respective community district" in the immediately preceding month, plus "all unresolved requests for service from prior months", each with "(1) the request for service category; (2) the agency or agencies to which the request for service was directed; and, (3) the current status" |

§ 1075(a) defines a "directory assistance call" as "any call received by the 311 citizen service
center that is entered into the 311 computer system in the directory assistance category"
(Charter text current through L.L. 2026/160).

## What every answer carries

The Phase 0 envelope (`data_as_of`, `latest_request`, `boardstat_url`, `caveats`, `source`,
optional `warning`/`stale`, `data`) plus a `mandate` block:

- `charter_section`, `rebuilds`, `law`, `status` (`current` or `repealed`), `repealed_by` (for (b) and (c)), and `text` (the law's words);
- `note`: "This is a BetaNYC rebuild from NYC Open Data, not the City's official report. Only the City can meet § 1075.";
- `omissions`: the ZIP code breakdown, **omitted by BetaNYC's decision** (ZIP codes are postal delivery areas, not City districts, so this server does not use them), and anything before 2020-01-01 (the law counted from April 1, 2004).

No ZIP code appears anywhere: no key names one (`assertNoZip`), no string holds one
(`assertNoZipValues`; free text goes through `redactZip`), no Parquet read names or filters a
ZIP column, and no SoQL query names one (`assertNoZipSoql`).

## Periods

`month` (`YYYY-MM`) or `fiscal_year` (`2027`, `"FY2027"`, `"FY27"`), never both. A month's
answer also gives the fiscal year to date through that month's end, as the law's "fiscal
year-by-year basis" and the City's FYTD columns do. With neither, the newest complete month in
the data. Periods are cut to the data (2020-01-01 to the newest request), with a note.

## `ll47_service_request_report`

- **One community or Council district**: reads that district's BoardStat file. Category is the
  City's complaint type as published (`complaint_type_raw`). Statuses are the City's. Days to
  close count only requests marked Closed with a usable close date (BoardStat's
  `days_to_close`); the average is the law's "average resolution time", the median is a labeled
  BetaNYC addition. A request is in the month it was created; its status is as of the build.
- **Citywide or one borough**: by default from BoardStat's month file (`agg/month_type.parquet`,
  1.6 MB): totals by problem, using BoardStat's grouped problem names. `complete: false` says the
  agency, status and time tables are missing and how big the full read is.
  `read_every_district: true` reads every community district file in scope (Joint Interest
  Areas included): 71 files, about 860 MB citywide in the 2026-11-07 build, downloaded once per
  nightly build and cached. Measured locally: 3.7 s and 790 MB peak memory for October plus
  FYTD, citywide. Files are read one at a time and tallied, so memory does not grow with the
  number of files.
- **`by_district`** (`community_district`, `council_district` or `borough`): one row per
  district, month and fiscal-year totals and the top problem, from the month file. `borough`
  narrows it.

Only requests with a usable location are in BoardStat's district files (429,837 of 23.0 million
since 2020 have none), so these totals leave out requests the City could not place.

## `ll47_directory_assistance_report`

Reads [311 Call Center Inquiry](https://data.cityofnewyork.us/d/wewp-mm3p) (`wewp-mm3p`):
"all agent-handled calls to the City's 311 information line, including date, time and topic".
Columns, from the dataset's metadata (`/api/views/wewp-mm3p.json`) and its data dictionary:
`unique_id`, `date`, `time`, `date_time`, `agency`, `agency_name`, `inquiry_name` ("Topic the call
center representative used to resolve the customer's inquiry"), `brief_description`,
`call_resolution` ("How the call ended/was resolved": Information Provided, Transfer to City
Agency, CSMS SR, Routed to Web Page, Internal Transfer, Caller Hung Up, Hot Transfer 911,
Universal Intake SR, Referral, Agency Closed, Alert Information Provided).

**It ships marked `limited: true`**, because the data cannot support the report as the
law wrote it:

1. Nothing in the dataset marks a call as entered "in the directory assistance category". The
   report counts every agent-handled call by topic and shows the one topic named "Directory
   Assistance" separately (2,333 calls in October 2026).
2. `agency` and `call_resolution` are **blank for every call in every month checked, January 2022
   through November 2026** (a count of non-null values, by month, 2026-11-07; 2021 and 2020 timed
   out or failed on the portal). The metadata still counts 74,923,274 older rows with an agency.
   So there is no breakdown by agency, and calls that only got information cannot be told from
   calls that became service requests. The report says so; it does not guess.
3. The dataset's own description: since March 2020 it "does not fully represent the agent-handled
   calls to 311. The actual calls handled are higher."

Queries, built from Socrata's SoQL documentation, two shapes. First, one light query per month:
`$select=inquiry_name, count(*) AS n, count(agency) AS with_agency, count(call_resolution) AS
with_resolution`, `$where` on `date` for the month, `$group` and `$order` on `inquiry_name`, paged
with `$limit=50000`/`$offset` (`count(column)` counts non-null values). Only when a month's calls
do carry an agency or a call_resolution is it asked again with the full breakdown, `$group` and
`$order` on `inquiry_name, agency, agency_name, call_resolution`. October 2026 is 1,732 topics. It
took about 13 s on 2026-11-07. On 2026-11-09 the portal was slow: the light query took 40 and 58 s,
the four-column one 74 s, and a bare `count(*)` for the month 18 s. Socrata leaves null values out of each row, so a missing
key is a blank. A fiscal year to date is the sum of its months. Each month's answer is saved on
disk. A month that ended more than 7 days ago is answered from the saved copy for 30 days, whatever
the dataset version (its `rowsUpdatedAt` moves every night, so keying on it alone re-asked every
month daily). A recent month is asked again when the dataset changes. The metadata is re-read at
most hourly and saved too.

**When the portal is slow or down.** One call has a 58 s budget, waits and retries included, kept
under a minute because many MCP clients stop waiting for a tool then. Each request may take up to
55 s. A request that gets no answer in that time is not tried again, and neither is a failure that
took 5 s or more. The asked-for month is fetched first, then the rest of the fiscal year. If the
asked-for month gets no answer, the tool stops and says which: **"NYC Open Data is slow right
now"** when the portal was asked and did not answer in time, **"NYC Open Data is not responding
right now"** when it returned an HTTP 5xx or could not be reached. Months not reached are listed in
`months_missing`, each with a plain reason, the fiscal-year section says `complete: false` and
gives no partial total, and asking again finishes from the saved months. A cold fiscal-year-to-date
call **usually comes back `complete: false` the first time**; later calls complete it from the
saved months. Requests are never sent in parallel (engineering standards §6 forbids it for one
portal), so this is how a cold fiscal year stays inside client timeouts. If the portal cannot be reached, the saved copies answer with `stale: true`, a `warning`
and a caveat; with no saved copy for the asked-for month, the tool says so and does not answer.
Politeness (engineering standards §6): one request at a time, at least 2 s between request
starts, the gap doubled after a 429 (to 60 s) and halved after a success, `Retry-After` honored
on 429 and 503 (capped at 60 s), capped backoff on 5xx, a 120 s timeout, a package User-Agent,
and `X-App-Token` when `SOCRATA_APP_TOKEN` is set.

## `cb_monthly_list`

One community district, in three parts, in this order:

- `new_this_month`: every request created in the month (default: the newest complete month,
  the law's "immediately preceding month");
- `unresolved_from_prior_months`: every request created earlier (2020 on) whose status is not
  Closed **when the BoardStat data was built**;
- `unresolved_at_month_end_now_closed`: every request created earlier that was closed *after* the
  month ended, so it was unresolved at the month's end, by its own created and closed dates.

Open data keeps only each request's current status, so a past status cannot be rebuilt. For any
month other than the newest complete one the answer says so plainly (`status_note`, and a
caveat): "unresolved" is as of `status_as_of` (the build), and a § 1075(d) list sent at the month's end
would show the status as of then. The third part is what can be rebuilt of the month-end view.

Two kinds of inconsistent City records are counted in `record_problems`, with a caveat when
either is above zero. Requests marked Closed with no close date cannot be placed in the third
part, so they are left out (Manhattan CD 1 before 2024-03: 1,520). Requests not Closed today but
carrying a close date before the month's end are listed as unresolved, by their current status
(Manhattan CD 1, 2024-03: 391).

Each row: `section`, `unique_key` (NYC Open Data's id, not the 311 number), `created`, `closed`, `category`, `description`, `agency`,
`agency_name`, `status` (current, as of the build, which is what § 1075(d)(3) asks), `address`
(as the City wrote it, ZIP codes removed). Ordered by created time, then number, within each
part. `limit` (up to 1,000) and `offset`; the answer gives `next_page` (`offset` and
`data_as_of`). A page asked for with a `data_as_of` that is not the current build is refused
with a message to start again, so a list is never stitched from two builds. `part` keeps one
part; `format: "csv"` returns the page as CSV text with the same columns. The answer links to the
BoardStat page for the month, and gives a second link for the unresolved requests.

## Checking the numbers

### Against independent SQL

`scripts/accuracy_check.py` runs each tool over a local BoardStat folder and compares every
value with DuckDB SQL in `scripts/boardstat_oracle.py` (`sr_report`, `agg_report`, `cb_list`),
written from the law's list and BoardStat's columns. Build 2026-11-07T10:36:39Z:

| Q | Question | Values compared | Mismatches |
|---|---|---:|---:|
| L1 | Service request report, Manhattan CD 1, 2026-10 and FY2027 to date | 884 | 0 |
| L2 | Service request report, Council District 4, same | 2,230 | 0 |
| L3 | Service request report, citywide, every district file, same | 2,860 | 0 |
| L4 | Service request report, citywide, month file, same | 680 | 0 |
| L5 | Service request report, Queens, month file, 2026-10 | 295 | 0 |
| L6 | § 1075(d) list, Manhattan CD 1, 2026-10, first page of 1,000 | 1,006 | 0 |
| L7 | § 1075(d) list, Manhattan CD 1, 2026-10, the page where the parts meet | 1,006 | 0 |
| L8 | § 1075(d) list, Bronx CD 5, 2026-09, unresolved part | 1,001 | 0 |
| L9 | § 1075(d) list, Brooklyn CD 1, 2024-03, unresolved at month end and closed since | 1,002 | 0 |
| L10 | § 1075(d) list, Manhattan CD 1, 2024-03, record-problem counts | 2 | 0 |

Mutation check: counting every status except Open as closed, in `dist/`, gives 58, 152 and 312
mismatches in L1 to L3 and fails 4 unit tests.

### Against the City's 311 Reporting dashboards

§ 1075(b) no longer requires them, but the City still publishes them as Power BI dashboards on
[311 Reporting](https://www.nyc.gov/site/311reporting/311-reports/service-requests.page), and Admin Code
§ 23-306(d) requires a monthly public report by type and agency. They were
read on 2026-11-07 ("Data as of Nov-02-2026 ... October FY2027"). The full reports open on
**FY2022** and had to be set to 2027. The captured numbers are in
`docs/city-311-reporting/2026-11-02/`. The rebuild used BoardStat build 2026-11-07T10:36:39Z and
`wewp-mm3p` as of 2026-11-08T02:06:17Z. `scripts/city_comparison.py` prints the tables below
from those files and the tools' answers.

#### Service requests, October 2026 and FY2027 to date

| | City dashboard | BetaNYC rebuild | Difference |
|---|---:|---:|---:|
| Requests, October | 363,888 | 341,965 | -21,923 (-6.0%) |
| Requests, FY2027 to date | 1,415,966 | 1,318,781 | -97,185 (-6.9%) |
| October, only the 183 agency/type pairs both have | 349,252 | 341,965 | -7,287 (-2.1%) |
| FYTD, same pairs | 1,349,830 | 1,318,781 | -31,049 (-2.3%) |
| Agency/type pairs the City counts that BoardStat has none of | 52 pairs, 14,636 in October, 66,136 FYTD | 0 | |
| Pairs where the rebuild is higher than the City | | 0 | |

#### By agency, October

| Agency | City | Rebuild | Difference |
|---|---:|---:|---:|
| NYPD | 157,499 | 156,526 | -973 |
| HPD | 80,709 | 80,281 | -428 |
| DSNY | 35,702 | 26,515 | -9,187 |
| DOT | 22,379 | 18,943 | -3,436 |
| DEP | 17,910 | 17,692 | -218 |
| DOB | 12,216 | 9,535 | -2,681 |
| DPR | 10,447 | 10,240 | -207 |
| DHS | 8,102 | 7,943 | -159 |
| DOHMH | 7,869 | 7,843 | -26 |
| DOF | 3,933 | 0 | -3,933 |
| TLC | 3,497 | 3,366 | -131 |
| DCWP | 2,135 | 2,052 | -83 |
| EDC | 526 | 526 | 0 |
| OOS | 476 | 476 | 0 |
| HRA | 310 | 0 | -310 |
| OTI | 153 | 27 | -126 |
| DFTA | 23 | 0 | -23 |
| NYCEM | 1 | 0 | -1 |
| DORIS | 1 | 0 | -1 |

#### The City's top 10, October and FYTD

| Agency | Complaint type | City month | Rebuild month | City FYTD | Rebuild FYTD |
|---|---|---:|---:|---:|---:|
| NYPD | Illegal Parking | 59,708 | 59,307 | 213,282 | 211,827 |
| NYPD | Noise - Residential | 35,425 | 35,364 | 127,620 | 127,307 |
| HPD | HEAT/HOT WATER | 26,477 | 26,451 | 39,381 | 39,324 |
| NYPD | Blocked Driveway | 17,440 | 17,408 | 63,093 | 63,002 |
| NYPD | Noise - Street/Sidewalk | 16,813 | 16,640 | 84,901 | 84,206 |
| HPD | UNSANITARY CONDITION | 14,432 | 14,341 | 56,821 | 56,460 |
| DSNY | CFC Recovery | 8,437 | 0 | 38,404 | 0 |
| DOT | Street Condition | 7,522 | 5,508 | 35,310 | 25,354 |
| DEP | Noise | 7,215 | 7,117 | 21,917 | 21,633 |
| HPD | PLUMBING | 7,191 | 7,141 | 28,611 | 28,431 |

#### Largest types the City counts and BoardStat has none of (October)

| Agency | Complaint type | City month | City FYTD |
|---|---|---:|---:|
| DSNY | CFC Recovery | 8,437 | 38,404 |
| DOF | DOF Literature Request | 1,550 | 6,067 |
| DOF | DOF Parking - Payment Issue | 938 | 4,091 |
| DOB | Construction Safety Enforcement | 795 | 3,049 |
| DOF | DOF Property - Payment Issue | 415 | 2,101 |
| HRA | Benefit Card Replacement | 310 | 1,149 |
| DOT | DOT Literature Request | 243 | 1,069 |
| DOF | DOF Property - Update Account | 212 | 1,104 |
| DOF | DOF Property - Request Copy | 190 | 1,068 |
| DOF | DOF Parking - Request Copy | 185 | 620 |
| DOF | DOF Property - Reduction Issue | 139 | 322 |
| OTI | Cable Complaint | 126 | 524 |

#### Calls and inquiries, October 2026 and FY2027 to date

| | City dashboard | BetaNYC rebuild (wewp-mm3p) | Difference |
|---|---:|---:|---:|
| Inquiries (agent-handled calls), October | 295,683 | 295,665 | -18 |
| Inquiries, FY2027 to date | 1,201,730 | 1,201,636 | -94 |
| All calls to 311, October | 1,018,589 | not in the open data | |
| Topic "Directory Assistance", October / FYTD | 2,333 / 9,282 | 2,333 / 9,282 | 0 / 0 |

Topics whose October count differs (case ignored): 18
- nyc311: City 975, rebuild 974
- mosquitoes: City 18, rebuild 17
- city agency or worker feedback: City 6,359, rebuild 6,358
- taxi complaint: City 552, rebuild 551
- food poisoning: City 134, rebuild 133
- fallen tree or branch: City 1,284, rebuild 1,283
- service request status: City 6,332, rebuild 6,331
- car service complaint: City 298, rebuild 297
- street vendor complaint: City 592, rebuild 591
- smoking or vaping complaint: City 323, rebuild 322
- food safety complaint: City 354, rebuild 353
- harassment: City 867, rebuild 866
- tax preparation services complaint: City 7, rebuild 6
- pigeon droppings or odor: City 60, rebuild 59
- assault: City 205, rebuild 204
- bridges: City 87, rebuild 86
- park maintenance complaint: City 568, rebuild 567
- fence complaint: City 83, rebuild 82

The City's dashboard pages read show no status or resolution time, so those have no City
number to compare with. The rebuild's citywide October figures: Closed 290,859, Open 28,948, In
Progress 21,031, Assigned 1,034, Pending 67, Unspecified 26; average 2.1 days to close, median
0.2 (FY2027 to date: average 4.6, median 0.2).

#### Why they differ

| Difference | Size (October) | Likely cause | Checked? |
|---|---:|---|---|
| 52 agency/complaint-type pairs on the dashboard have no request at all in BoardStat (every DOF type, DSNY "CFC Recovery", HRA "Benefit Card Replacement", literature requests, DOB "Construction Safety Enforcement", ...) | 14,636 | These requests have no usable location in the open data, or are not in the open dataset `erm2-nwe9` at all. BoardStat filters nothing by type (its pull's only condition is the date). | Not settled: it needs counts from `erm2-nwe9`, which this phase does not query. Open item. |
| In the 183 pairs both have, the rebuild is 2.1% lower (FYTD 2.3%), and lower in every pair where they differ, never higher | 7,287 | BoardStat leaves out requests with no usable location; the City counts them (1.9% of all requests since 2020 have none). Large in DOT "Street Condition" (7,522 vs 5,508) and DOB types, where locations such as highways may not geocode. | Consistent with BoardStat's manifest counts; not checked per request. |
| Complaint-type spelling: "Elevator" / "ELEVATOR", "PLUMBING" / "Plumbing" (DOB) | 0 | The dashboard and the open data capitalize some types differently. The comparison ignores case. | Yes |
| The City's data is as of Nov-02; the rebuild's of Nov-07 | small | Requests published after Nov 2 would make the rebuild higher, not lower; none is higher. | Yes (direction) |
| Inquiries: 18 topics are each exactly one call higher on the dashboard | 18 (FYTD 94) | Unknown. Possibly calls not included in the public dataset, or a difference between refreshes. | No |
| "Calls to 311" (1,018,589) | | All calls, including those that never reach an agent; the open dataset holds agent-handled calls only. Not comparable. | n/a |
