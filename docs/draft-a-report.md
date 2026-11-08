# Draft a 311 report (Phase 5, #18)

Built and reviewed 2026-11-07, about 22:35 to 22:50 ET. Closes #10.

`draft_311_report` turns what a person says about a problem into a short report **they submit
themselves**: a ready-to-paste text, the 311 Online article to report it on, and what is still
missing. Decided by Noel and Marvin on 2026-11-07: **the server never files, starts or submits a
311 request**, never calls the 311 Developer Partner product, and never opens or fills a portal
form. Nothing in the answer is sent anywhere.

## Why the draft has the fields it has

The City publishes the fields each 311 form asks for nowhere: not in the 311 Public API's
operations, not in any NYC Open Data dataset, and not on the article pages, where the Report
button runs JavaScript (research note
`team/research/311-reporting-mandates/2026-11-07-311-request-type-sources.md` in the BetaNYC
workspace). So the draft carries the facts every report needs, and says plainly: "The City does
not publish each form's exact fields, so the form may ask for things this draft doesn't cover."

| Part | Where it comes from |
|---|---|
| **What**: the article, its 311 problem type, Problem Detail | `how_to_report`'s match (called, not copied, so its fixes apply here). Problem Detail options from the 311 Service Level Agreements dataset, labeled old (below). |
| **Where**: address, cross streets or landmark; borough | The person. A ZIP code they type is left out (no ZIP codes in any answer). A reminder that 311 asks where and may ask to set it on a map, labeled BetaNYC wording. |
| **When**: date and time; still happening, stopped, keeps happening | The person. |
| **Details** | The person. Email addresses and phone numbers in their words are left out unless they pass `include_contact`. |
| **What the City says you need** | The article's "What You Need" lines, quoted, turned into questions (KA-01803 litter: "Timeframe and the days of the week when littering occurs", "Type of material being littered"). |
| **Contact** | The article's sentences about contact information, quoted ("you must provide your contact information" on the heat, pest, mold and leak articles). Reporting anonymously is mentioned only if the article says so; none of the recorded articles does. |
| **Photos** | The article's sentences about attachments, quoted (KA-01091: "Picture or video attachments may be used for informational purposes only."). Otherwise only "Have photos ready if you have them." |
| **What happens next** | The article's "What Happens Next"; then: keep the service request number, look it up with `get_service_request` or 311 Online's "Look Up Service Requests" page, <https://portal.311.nyc.gov/check-status/> (200 on 2026-11-07, linked from the portal home page as "Look Up Service Requests"). |

Anything missing goes into the text as `[add: …]` and into `questions_to_ask`. Nothing is made
up: the draft holds only the person's words and the names the City's article uses.

### When there is no draft

- **Emergency**: if `how_to_report` gives an emergency answer, there is no draft, only that
  answer (the City's "Call 911" wording where an article has it). A description that also names
  a 311 problem ("someone got hurt in a car crash and there is a pothole") is not drafted either.
- **Not taken by 311**: if the article's summary says the City does not take it (KA-01332
  Neighbor Odor: "The City does not accept complaints about body or cooking odor from a
  residence."), or the article has no report option, no phone way, and says who handles it,
  there is no draft, only the City's words.

### Two problems in one description

311 takes one problem per report. The description is split at ";", a sentence break, "also" or
"plus"; failing that, at "and". Each part is matched with `how_to_report`. It becomes two drafts
only when the parts match different articles in different 311 categories, each clearly (at
"and", each strongly). "Trash and litter all over the sidewalk" and "the sidewalk wasn't
shoveled and it's icy" stay one problem. At most three drafts.

## Problem Detail options: `cs9t-e3x8`, last updated 2024-03-05

[311 Service Level Agreements](https://data.cityofnewyork.us/d/cs9t-e3x8), published by OTI.
Columns, from its metadata (`/api/views/cs9t-e3x8.json`, read 2026-11-07): `agency`, `problem`
("the first level of a hierarchy"), `problem_details`, `additional_details`, `sla_days` ("Amount
of time the Agency needs to address the request", text). 3,563 rows, 274 problems. Its metadata
says "Annually", but its rows were last updated **2024-03-05**, so every answer labels the
options old and the form's choices may differ.

- Read whole: one metadata request and one rows request (`$select` the five columns, `$order`
  on them, `$limit=5000`), through the workspace's polite Socrata client (`src/soda.ts`: one
  request at a time, 2 s apart, timeouts, Retry-After). About 650 KB.
- Kept 30 days on disk. After that the metadata is checked; the rows are read again only if
  `rowsUpdatedAt` changed. NYC Open Data down: the saved copy answers, marked stale; no saved
  copy: the draft is made without options, and says so.
- Matched on the article's problem type, case aside (the dataset has both "HEAT/HOT WATER" and
  "Heat/Hot Water"), and on the article's agency when it named one. "N/A" is treated as blank.
- A Problem Detail goes **into the draft** only when the article's report option names it and the
  person's words say so too. KA-01093's only report option is "Cave-in"; a person who said
  "pothole" does not get "Cave-in" in their draft. A detail guessed from the words alone is a
  question ("Is it "Loud Music/Party"?"), never the draft. "Block" in "my block" is not read as
  "Blocked - Construction".

Recorded for tests: `test/fixtures/soda/cs9t-e3x8/view.json` (metadata) and `rows.json` (the 255
rows for the 20 problem types the recorded articles name). No ZIP codes in either.

## Review: 20 common problem types and 10 harder cases

`node scripts/draft-report-review.mjs`, over the 311 content recorded for #17 and the recorded
`cs9t-e3x8` rows. No network. The 20 common descriptions are the #17 review set (BoardStat's 20
most common problem types citywide, 2025-11 to 2026-10), given with no place or time, so each
draft must ask for them. Every row is also a test (`test/draft-report.test.mjs`).

| # | Input (description / location / borough / when) | Matched article | Placeholders | Questions | Detail options (2024) | Problems |
|---|---|---|---|---:|---|---|
| C1 | a car is parked in front of the fire hydrant on my street | KA-01986 Illegal Parking | [add: where] [add: borough] [add: when] | 5 | 14 | 14 Illegal Parking options; question lists them by count (more than 8) |
| C2 | loud music next door at 2 am | KA-01017 Noise from Neighbor | [add: where] [add: borough] [add: when] | 5 | 4 | asks *when* although the description says "at 2 am" (times in the description are not read) |
| C3 | no heat in my apartment | KA-01036 Heat or Hot Water Complaint in a Residential Building | [add: where] [add: borough] [add: when] | 5 | 1 | none; article's report option names "Apartment Only" and the words agree; City says contact is required |
| C4 | someone parked and is blocking my driveway | KA-01062 Blocked Driveway | [add: where] [add: borough] [add: when] | 5 | 2 | none |
| C5 | people yelling and playing loud music on the sidewalk | KA-01092 Noise from Street or Sidewalk | [add: where] [add: borough] [add: when] | 5 | 2 | suggests "Loud Music/Party" as a question, not in the draft |
| C6 | mice and roaches in my apartment | KA-02278 Residential Pest Complaint | [add: where] [add: borough] [add: when] | 6 | 4 | none; City says contact is required |
| C7 | my toilet is broken and the landlord won't fix it | KA-01074 Apartment Maintenance Complaint | [add: where] [add: borough] [add: when] | 6 | 0 | article names no problem type, so no options; asks which report option fits |
| C8 | a pothole on my block | KA-01093 Pothole or Cave-In on Street | [add: where] [add: borough] [add: when] | 5 | 17 | the 2024 list has no "Pothole" option for Street Condition (the portal's pothole form is a separate link with no action, #17); 17 options shown are mostly not potholes |
| C9 | a car has been abandoned on my street for weeks | KA-02130 Abandoned Vehicle | [add: where] [add: borough] [add: when] | 5 | 0 | no problem type picked (NYPD with plates, DSNY without), so no options; asks which report option fits |
| C10 | the paint is peeling and the plaster on my apartment ceiling is cracked | KA-01074 Apartment Maintenance Complaint | [add: where] [add: borough] [add: when] | 6 | 0 | as C7 |
| C11 | trash and litter all over the sidewalk | KA-01803 Dirty Sidewalk | [add: where] [add: borough] [add: when] | 6 | 6 | none; the City's "What You Need" (timeframe, material) become questions |
| C12 | a fire hydrant is open and running | KA-01034 Fire Hydrant Complaint | [add: where] [add: borough] [add: when] | 4 | 18 | 18 options (article says Water Maintenance) |
| C13 | the sidewalk wasn't shoveled and it's icy | KA-01397 Snow or Ice on Sidewalk | [add: where] [add: borough] [add: when] | 5 | 0 | none; passes on DSNY's "isn't taking complaints right now" |
| C14 | loud music from the bar downstairs | KA-01085 Noise from Bar, Club, or Restaurant | [add: where] [add: borough] [add: when] | 4 | 6 | none |
| C15 | construction jackhammer noise early in the morning | KA-01091 Noise from Construction | [add: where] [add: borough] [add: when] | 4 | 12 | none; quotes the City on picture/video attachments |
| C16 | the lock on my apartment door is broken and the landlord won't fix it | KA-01074 Apartment Maintenance Complaint | [add: where] [add: borough] [add: when] | 6 | 0 | as C7 |
| C17 | the traffic light at the corner is broken | KA-01404 Traffic or Bicycle Signal Complaint or Request | [add: where] [add: borough] [add: when] | 4 | 0 | phone only: the draft is notes for the call |
| C18 | a car honking its horn and blasting music all night | KA-01102 Noise from Vehicle | [add: where] [add: borough] [add: when] | 5 | 3 | none |
| C19 | water leaking from the ceiling in my apartment | KA-01509 Water Leak in a Building | [add: where] [add: borough] [add: when] | 6 | 3 | none; City says contact is required |
| C20 | a homeless encampment under the overpass | KA-02253 Homeless Encampment | [add: where] [add: borough] [add: when] | 4 | 0 | Encampment rows have no Problem Detail, so no options |
| T1 | there's a pothole / Queens / this morning | KA-01093 Pothole or Cave-In on Street | [add: where] | 2 | 17 | none |
| T2 | mice and roaches in my apartment / 123 Main Street / every night | KA-02278 Residential Pest Complaint | [add: borough] | 3 | 4 | none; borough asked ("123 Main Street" is in several boroughs) |
| T3 | something is broken outside | drafted_without_article | [add: which problem this is] [add: where] [add: borough] [add: when] | 5 | 0 | no article: a usable draft with a placeholder for the problem; points to how_to_report / list_311_categories |
| T4 | I smell gas in my kitchen / 45 Elm St / Bronx | none: call 911 | none | 0 | - | no draft; how_to_report's 911 line (KA-02048) |
| T5 | there's a fire in the building next door | none: call 911 | none | 0 | - | no draft; 911 (KA-01543) |
| T6 | someone got hurt in a car crash and there is a pothole | none: call 911 | none | 0 | - | no draft even though a pothole is also named; 911 (KA-01513) |
| T7 | my neighbor's cooking odor comes into my apartment | KA-01332 Neighbor Odor | none | 1 | 0 | no draft: the City's summary of KA-01332 says it does not accept these. Decided from the summary (the full article was not recorded) |
| T8 | loud music from the bar downstairs and mice in my apartment / 200 Bedford Ave / Brooklyn | KA-01085 Noise from Bar, Club, or Restaurant + KA-02278 Residential Pest Complaint | [add: when] [add: when] | 6 | 6+4 | none; two drafts sharing the place |
| T9 | trash and litter all over the sidewalk; also someone is blocking my driveway / Grand Concourse and E 161 St / Bronx / Nov 6, 7 pm | KA-01803 Dirty Sidewalk + KA-01062 Blocked Driveway | none | 5 | 6+2 | none; split at "also", not at the "and" in "trash and litter" |
| T10 | no heat in my apartment, call me at 917-555-0123 or jane@example.com / 10 W 100 St, New York, NY [ZIP code removed] / Manhattan / since Tuesday | KA-01036 Heat or Hot Water Complaint in a Residential Building | none | 1 | 1 | none; phone and email left out, ZIP left out |
**Machine part: 30 of 30 as expected.** All 20 common types land on the article `how_to_report`
picks (the #17 review's 20 of 20), one draft each, none split; each asks for where, borough and
when. Emergencies (3) get no draft. The not-311 case gets the City's words. Two-problem cases get
two drafts. Weak spots are in the Problems column: the 2024 list has no pothole option, articles
that name no problem type get no options, and times inside the description are not read.

**Testing with real people on real problems is still to do** (the "done when" on #18). That is
Noel's part: people describing problems they actually have, then trying the draft on 311 Online,
and noting what the form asked that the draft did not.

## Not done, on purpose

- No filing, no form-filling, no browser, no call to the Developer Partner product.
- No recording of the form's fields by hand (that would mean opening forms without submitting;
  it needs Noel's explicit approval, per the research note).
- No model call and no new dependency.
