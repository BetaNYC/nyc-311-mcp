# How to report a problem to 311 (Phase 4, #17)

Evidence read and calls made 2026-11-07, about 22:15 to 22:30 ET.

`how_to_report` takes a plain description ("a pothole on my block", "loud music next door at
2 am", "no heat in my apartment") and returns the 311 article that fits, the agency and the 311
problem type the article names, what the article says to do, and the ways to report. Everything
it says about reporting is City text. **It files nothing**: epic #12 decided that reporting stops
at a guide and a draft (#18), and the server will not file requests on anyone's behalf.

`list_311_categories` lists 311's own categories, or the articles in one, so a person (or an
assistant) can browse when a match looks wrong and pass `category_id` back to `how_to_report`.
It is a separate tool because browsing has a different input and answer from matching; folding
it into `how_to_report` would give that tool two unrelated modes.

## The City source

The NYC 311 Public API (product "NYC 311 Public Developers", the same `NYC_311_API_KEY` the other
tools use) has three content operations, documented in the portal's operation list
(<https://api-portal.nyc.gov/api-details#api=nyc-311-public-api>, read through its backing
endpoints `/developer/apis/nyc-311-public-api/operations/<id>` and `/schemas/<id>`):

| Operation | Documented | What the live API returned (2026-11-07) |
|---|---|---|
| `GET /api/GetCategory?max-level={int}` | "retrieve all categories, and optionally sub-categories"; up to three levels; end nodes have articles; `max-level` defaults to 2 | `{ Categories: [...] }`: 115 categories. Each sub-category appears **twice**: in the flat list (with `ParentCategoryId`) and nested under its parent's `SubCategory`. The client keeps each id once. |
| `GET /api/GetContentList?categoryId={id}` | "a list of content article summaries"; the schema names `kanumber`, `title`, `description` | `{ ContentArticleList: [{ id, title, description }] }`: the key is `id`, not `kanumber`. Parent categories and "A to Z" (`311-19`) return an empty list. |
| `GET /api/GetContent?SearchText={id}` | "Returns content details"; no response schema | `{ KnowledgeArticle: [{ ArticlePublicNumber, Title, Description, Section: [{ Name, Content (HTML), ContentAction: [{ Name, Agency, Problem?, ProblemDetail? }] }] }] }`. Asked with a KA number, it returned exactly that article in each of the 21 calls. |

An article's link is `https://portal.311.nyc.gov/article/?kanumber=KA-#####` (200 on the portal).
The `ContentAction.Problem` is the open-data `complaint_type` (`erm2-nwe9` describes that column as
"Problem (formerly Complaint Type)"), except where noted below. The ways to reach 311 come from
<https://portal.311.nyc.gov/about-nyc-311/>, read 2026-11-07: "Call 311 or 212-NEW-YORK
(212-639-9675) to connect with us: Outside of New York City, Using a Voice over Internet Protocol
(VoIP) provider, Using 711 or a teletypewriter (TTY) service, Using a Video Relay Service (VRS)";
"Text 311-692"; and "Download the NYC311 App: File and track service requests on the go", with
its Google Play and App Store links. The 311 Online search link is the portal's own search form
(`/search?q=`, which answers at `/search/?q=`).

Not used: `vwpc-kje2` (the old service catalog, frozen since 2019) and the Service Level
Agreements dataset `cs9t-e3x8` (last updated 2024-03-05; a candidate for #18's Problem Detail
options, labeled as old).

**One observation, not used:** `GetContent` with a phrase instead of a KA number
(`SearchText=traffic signal`) returned 67 whole articles ranked by `TotalWeight`, which looks
like the portal's own search. The documentation calls `SearchText` "the identifier", the answer
was 337 KB, and using it would send a person's words to the City. The tool does not use it.

## How matching works

Deterministic, no model call, no new dependency (`src/how-to-report.ts`):

1. **Words.** `CONCEPTS` turns everyday words into the words 311's titles use ("next door" →
   *neighbor*, "roaches" → *pest*, "pothole" → *pothole, cave-in, street*), each with a weight,
   and names the 311 categories to search. It was written against the category tree and the
   titles returned on 2026-11-07. A hint whose category is gone is skipped.
2. **Categories.** The hinted categories, then any whose own name or description matches well,
   up to five. A danger word always adds Safety & Crime, where the City's "Call 911" articles are.
3. **Articles.** Each article in those categories scores 3 × weight for a word in its title and
   1 × weight for one in its summary. "Report …" summaries get +1; "Learn / Get / Apply …" −2;
   "Call 911 …" +6 when the description suggests danger and −3 when not. Ties go by title.
   Below 4 is no match.
4. **The best article is read in full** (one `GetContent`); alternatives are listed from their
   summaries. Within the article, the report action whose name, detail or section best matches
   the description is picked. When the actions go to different agencies or problem types
   (Abandoned Vehicle: NYPD with plates, DSNY without), a pick needs a word that is not in the
   title; otherwise none is picked and all are listed (`no_best_action`). An action for a narrower
   case ("City Vehicle …", "Commercial …") does not win unless the description says so.

Confidence: *strong* (score 9 or more and 2 ahead of the next), *close call*, or *possible*.

**Emergencies.** If the description suggests danger (fire, smoke, gas, carbon monoxide, someone
hurt, a crime in progress, downed wires, a crash), `first_line` is the City's own summary of the
matched "Call 911" article, for example "Call 911 to report a gas leak or any gas-related
emergency or dangerous condition." (KA-02048). If no such article matched, it says "If anyone is
in danger, call 911 now. 311 is for problems that are not emergencies." and labels that as BetaNYC
wording. A matched article whose summary starts "Call 911" leads the same way even without a
danger word. `call_911` on a match carries the article's own 911 section.

**Privacy.** The description is not stored, logged, echoed, or sent anywhere; only 311 content is
fetched. The no-match search link carries the recognized words, not the description. ZIP codes in
article text (mailing addresses) are redacted, and the answer is checked for any left.

## Ways to report, as the tool states them

Per article, only what the article says: `online` when it has report actions (with the link);
`phone only` when its text says so ("Complaints can be made by phone only. Call 311 or 212-NEW-YORK
(212-639-9675) to report the problem." on KA-01404); otherwise `phone` when its text has the
Call-311 sentence. `file_a_complaint` passes on what the article says under "File a Complaint"
(on 2026-11-07, KA-01397: "DSNY isn't taking complaints right now. Either it hasn't snowed, or
property owners still have time to clear their sidewalks."). `how_to_reach_311` is the about-page
text above.

## District counts

With `community_district` or `council_district` (and optional `last_days`, default 365), the
answer adds `in_your_district`: the number of reports of the matched problem type there, from
`problem_trend` (BoardStat), with its BoardStat link. These are reports, not problems.

## Cost and caching

A first question makes at most 1 + 5 + 1 requests (categories, routed lists, the best article).
Each answer is cached on disk for 7 days (`NYC_311_MCP_CACHE_DIR/content-311/`), so most questions
make none. When the API cannot be reached, the saved copy answers with `stale: true` and a
`warning`. Requests go one at a time, at least 1 s apart, with a 30 s timeout and one retry on
429/503 honoring `Retry-After`.

## Review: the 20 most common problem types

The 20 most common `complaint_type` values citywide in BoardStat's `agg/month_type.parquet`,
2025-11 through 2026-10 (build 2026-11-07T10:36:39Z), with the agency on those requests from
BoardStat's detail files. For each, a description a resident might type, the top result of
`how_to_report` against the **live** API (`node scripts/how-to-report-review.mjs --live --seed`,
2026-11-07; the same responses are recorded in `test/fixtures/content/`, and
`test/how-to-report.test.mjs` checks every row), and whether the article fits.

| # | Problem type (open data) | Requests | Agency (open data) | Description typed | Top result | Agency (article) | Problem type (article) | Right article | Problem type matches |
|---|---|---:|---|---|---|---|---|---|---|
| 1 | Illegal Parking | 615,825 | NYPD | a car is parked in front of the fire hydrant on my street | KA-01986 Illegal Parking | NYPD | Illegal Parking | yes | yes |
| 2 | Noise - Residential | 418,059 | NYPD | loud music next door at 2 am | KA-01017 Noise from Neighbor | NYPD | Noise - Residential | yes | yes |
| 3 | HEAT/HOT WATER | 353,662 | HPD | no heat in my apartment | KA-01036 Heat or Hot Water Complaint in a Residential Building | HPD | Heat/Hot Water | yes | yes (case differs) |
| 4 | Blocked Driveway | 196,322 | NYPD | someone parked and is blocking my driveway | KA-01062 Blocked Driveway | NYPD | Blocked Driveway | yes | yes |
| 5 | Noise - Street/Sidewalk | 174,291 | NYPD | people yelling and playing loud music on the sidewalk | KA-01092 Noise from Street or Sidewalk | NYPD | Noise - Street/Sidewalk | yes | yes |
| 6 | UNSANITARY CONDITION | 139,650 | HPD | mice and roaches in my apartment | KA-02278 Residential Pest Complaint | HPD | Unsanitary Condition | yes | yes (case differs) |
| 7 | Plumbing | 89,186 | HPD (some DOB) | my toilet is broken and the landlord won't fix it | KA-01074 Apartment Maintenance Complaint | HPD | none named | yes | **no: the article names no problem type** |
| 8 | Street Condition | 79,303 | DOT | a pothole on my block | KA-01093 Pothole or Cave-In on Street | DOT | Street Condition | yes | yes (the cave-in action; the pothole form is a separate link with no action) |
| 9 | Abandoned Vehicle | 71,676 | NYPD | a car has been abandoned on my street for weeks | KA-02130 Abandoned Vehicle | NYPD with plates, DSNY without | Abandoned Vehicle | yes | yes (no agency picked until the plate is described) |
| 10 | PAINT/PLASTER | 69,465 | HPD | the paint is peeling and the plaster on my apartment ceiling is cracked | KA-01074 Apartment Maintenance Complaint | HPD | none named | yes | **no: as 7** |
| 11 | Dirty Condition | 69,162 | DSNY | trash and litter all over the sidewalk | KA-01803 Dirty Sidewalk | DSNY | Dirty Condition | yes | yes |
| 12 | Water System | 63,180 | DEP | a fire hydrant is open and running | KA-01034 Fire Hydrant Complaint | DEP | Water Maintenance | yes | **no: the article says "Water Maintenance", open data "Water System"** |
| 13 | Snow or Ice | 62,596 | DSNY | the sidewalk wasn't shoveled and it's icy | KA-01397 Snow or Ice on Sidewalk | none for sidewalks today | none for sidewalks | yes | **no: DSNY's sidewalk action is absent; the article says DSNY is not taking complaints now** |
| 14 | Noise - Commercial | 60,965 | NYPD | loud music from the bar downstairs | KA-01085 Noise from Bar, Club, or Restaurant | NYPD | Noise - Commercial | yes | yes |
| 15 | Noise | 60,704 | DEP | construction jackhammer noise early in the morning | KA-01091 Noise from Construction | DEP | Noise | yes | yes |
| 16 | DOOR/WINDOW | 54,635 | HPD | the lock on my apartment door is broken and the landlord won't fix it | KA-01074 Apartment Maintenance Complaint | HPD | none named | yes | **no: as 7** |
| 17 | Traffic Signal Condition | 53,700 | DOT | the traffic light at the corner is broken | KA-01404 Traffic or Bicycle Signal Complaint or Request | DOT (named in text) | none: phone only | yes | **no: the article has no report action** |
| 18 | Noise - Vehicle | 51,918 | NYPD | a car honking its horn and blasting music all night | KA-01102 Noise from Vehicle | NYPD | Noise - Vehicle | yes | yes |
| 19 | WATER LEAK | 49,304 | HPD | water leaking from the ceiling in my apartment | KA-01509 Water Leak in a Building | HPD | Water Leak | yes | yes (case differs) |
| 20 | Encampment | 46,279 | NYPD (DHS about a third) | a homeless encampment under the overpass | KA-02253 Homeless Encampment | DHS | Encampment | yes | yes; **agency differs: the article says DHS, two thirds of the requests are NYPD's** |

**Result: the right article 20 of 20. The article names the open-data problem type in 14 of 20.
The agency matches open data in 18 of 20** (row 20 differs; row 9's article splits by plate, and
all 12 months of open data are NYPD's "With License Plate"). None of the six problem-type misses
can be fixed with synonyms: in each, the City's article does not state the type, or states a
different name. They are listed here and the tool says so in each answer (`problem_type: null`,
`no_reportable_action`, or `file_a_complaint`).

## Live calls

46 read-only calls to the content operations on 2026-11-07, all 200: 1 `GetCategory`, 23
`GetContentList` (two of them, a parent category and "A to Z", to confirm they are empty), 22
`GetContent` (one of them the free-text observation above). No other 311 operation, no request
filed, no portal form opened.
