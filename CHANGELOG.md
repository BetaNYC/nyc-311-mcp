# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - Unreleased

Moves the shared BetaNYC module to 1.3.7. Tracking: BetaNYC/betanyc-ai-workspace#1655
(epic #1652).

### Changed

- `src/betanyc-tools.ts` and `scripts/whats_changed.py` are the shared module 1.3.7, copied
  unchanged from the workspace. Where BetaNYC changed the City's data, `about_data` and
  `data.json` now say "this data is BetaNYC's ... not an official record" (was "these figures
  ... not an official report"), and betanyc.github.io counts as BetaNYC's own site when routing
  error reports. `data.json` and `docs/data.json` rebuilt.
- `about_data` gives BetaNYC's address for questions and error reports about the data,
  lab@beta.nyc, as a line in its answer and as `contact_email` in `structuredContent`.
- On a server with no `NYC_311_API_KEY`, `about_data` says the 311 calendar and status
  alerts, the request lookups, and (when no copy was saved earlier) the 311 articles are
  not available on this server, instead of calling them live. Every other source answers
  as before. New export `unavailableSources()` in `src/tools.ts` decides this once, at
  startup.

## [1.3.0] - 2026-11-13

Adds three shared BetaNYC tools (every BetaNYC MCP server is getting them; nyc-311-mcp is
the first), a "What's changed" page on the
website, and a list of data sources with a DCAT-US 3.0 catalog made from it. Tracking:
BetaNYC/betanyc-ai-workspace#1645 (epic #1637); about_data: #1654 (epic #1652).

### Added

- `whats_changed`: what changed in this server, newest first, from `WHATS-CHANGED.md`
  (filters: `since`, `tag`, `limit`). Answers with readable text and `structuredContent`
  matching a declared `outputSchema`.
- `about_betanyc`: who built the server, the repository, where to report a problem, and
  BetaNYC's links.
- `src/betanyc-tools.ts`, copied unchanged from the workspace's
  `scripts/mcp_shared/betanyc-tools.ts` (now v1.3.5, with `scripts/whats_changed.py` and the validator kit). Never edit the copy; change the canonical
  file and copy it again. The two new tools do not answer from City data, so their text ends
  with the safety line's 911 sentence only, not the City-data part; their
  `structuredContent` is the shared module's, unchanged.
- `about_data`: where each kind of data comes from, from `DATA-SOURCES.json` (10 sources): the
  publisher, whether the figures are an official record or BetaNYC's, what BetaNYC changed,
  coverage and gaps, terms and credit line, where to check a figure and where to report an
  error, the tools that use it, and corrections that touched it. `topic` takes a source id or
  a tool name. How current each source is comes from what this server last saved (BoardStat's
  manifest, the NYC Open Data and 311 content caches), read by freshness hooks in
  `src/tools.ts` without the network; a source nothing has been fetched for says so. Its text
  ends with the safety line's 911 sentence, like the other two shared tools.
- `DATA-SOURCES.json`, and `data.json` (DCAT-US 3.0) made from it by
  `scripts/whats_changed.py about-data catalog`, at the repo root. Both ship in the npm package
  (`files`). A copy is on the website too (`docs/data.json`), and `about_data` gives its
  address. The contact address for data questions is lab@beta.nyc. No `croissant.json`: this
  repo publishes no data files (BoardStat does).
- The server instructions tell AI apps to call `about_data` for questions about sources,
  freshness, officialness and checking, and `about_betanyc` for who built the server.
- `test/about-data.test.mjs`: every tool must be listed under a source
  (`assertEveryToolExplained`), and `about_data` is checked for several topics, in process and
  over stdio against its output schema.
- CI: an `about-data` job runs `about-data check --tools-file` with the server's real tool
  list, `about-data catalog --check` for `data.json`, and the pinned validators
  (the `DATA-SOURCES.json` JSON Schema and the vendored DCAT-US 3.0 schema), and checks that
  `docs/data.json` matches `data.json`. The Release workflow runs `about-data check
  --release` before `npm publish`.
- `WHATS-CHANGED.md`, the reader-facing record of changes, backfilled to 1.0.0, and shipped
  in the npm package (`files`).
- `docs/whats-changed.html`, built from it by `scripts/whats_changed.py` (copied unchanged
  from the workspace), with a `whats-changed` layout that supplies the page's one `<h1>`.
  Every page links to it in the footer.
- CI: a `whats-changed` job runs `whats_changed.py check --base-ref` (append-only, and a
  version bump needs an entry) and `render --check` on the page. The release workflow runs
  `check --release` before `npm publish`, so a release cannot ship while the
  `WHATS-CHANGED.md` entry still says `Unreleased`.

### Changed

- 24 tools instead of 21: README, website, install guide and the safety-line test.
- The tool size budget is 47,000 characters (was 35,200), for the three new tools' output
  schemas; the shared tools, copied unchanged, may be up to 5,500 characters each.

## [1.2.0] - 2026-11-09

The first release with all 21 tools. It is 1.2.0-beta.19 with release metadata and the docs
for a release; the tools did not change. Everything below, from 1.2.0-beta.1 on, is in it.

### Added

- 17 new tools since 1.1.0: help reporting a problem (`how_to_report`, `draft_311_report`,
  `list_311_categories`), eleven district tools that read BoardStat, and three rebuilt Local
  Law 47 of 2005 reports. `get_status`, `get_service_request` and `get_service_request_list`
  now answer in plain language.
- Every answer from every tool ends with "For informational purposes only. BetaNYC builds
  these answers from City data; they may contain errors. Check the City's 311 page before you
  report. If this is an emergency, or if you think this is an emergency, call 911."
- Listing in the official MCP Registry as `io.github.BetaNYC/nyc-311-mcp`: `mcpName` in
  `package.json`, `server.json`, `.github/workflows/publish-mcp.yml` (runs after a successful
  Release), and a step in `release.yml` that checks `server.json` matches `package.json`.
- `glama.json`, so BetaNYC can claim the Glama listing.

### Documentation

- README, website and install guide describe 1.2.0 on npm. The beta guide says the beta has
  ended; the old `beta` branch is retired (#27).
- Before the release (#29): README rewritten: the released version (1.1.0) first, then the beta, with every beta tool
  listed with what it does, things to ask, and its inputs. Fixed the Claude Code setup, which
  pointed at `.claude/settings.json`; it now uses `claude mcp add`.
- A website for GitHub Pages in `docs/`: a home page, a page for every tool with a replay of a
  real question and answer, and the beta guide in the same layout. Built by `site-src/`, which
  checks every demo line against a real answer.
- The beta guide now installs from `main`. The old `beta` branch stopped at 1.2.0-beta.5.

## [1.2.0-beta.19] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (before merge, 2026-11-09)

- "a dog walker fell into a sinkhole" got a pothole answer and no 911 in `how_to_report` and
  `draft_311_report`. The holes class required the person before the verb to be a known
  person word ("walker" was not one); beta.17's test used only the hole-first wording ("a
  sinkhole opened and a dog walker fell in") and only the danger detector. Now the verb and the
  hole are enough (fell into, fell in, fell down, fallen into, slipped into, dropped into a
  sinkhole, manhole, trench, hole or shaft), with objects, vehicles and animals excused. A new
  test crosses those verbs and holes and calls both tools.

## [1.2.0-beta.18] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Changed: Noel's final closing text (beta round 18)

- Every response from all 21 tools, success or error, now ends with exactly: "For
  informational purposes only. BetaNYC builds these answers from City data; they may contain
  errors. Check the City's 311 page before you report. If this is an emergency, or if you think
  this is an emergency, call 911." It replaces beta.17's 911-only line, so the 911 sentence
  appears once. The structured `safety_line` field carries the same text, and the server
  instructions sent at connect include it once. Detected dangers still lead `how_to_report`'s
  and `draft_311_report`'s `first_line` with their stronger 911 line at the top.

## [1.2.0-beta.17] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Changed: the closing safety sentence (Noel's decision, beta round 17)

- Every response from all 21 tools, success or error, now ends with exactly "If this is an
  emergency, or if you think this is an emergency, call 911." as its last line, like the end
  of a doctor's office phone message; it is no longer the first line. The structured answer
  keeps it as its first field (`safety_line`). An error message carries it once, at the end.
  When a danger is detected, `how_to_report` and `draft_311_report` still lead `first_line`
  with their stronger 911 line at the top. This sentence is what the server relies on; danger
  spotting stays a best effort.

### Fixed (beta retest 16, 2026-11-09)

- The sensitive-article guard covers every article shown, best match, alternatives and other
  problems alike, and now also family, protective and end-of-life articles (Foster Care
  Agency, Adult Protective Services, Death Investigation, funeral and cemetery articles,
  Missing Person, Runaway). "Foster Care Agency Complaint" is no longer offered for trash
  outside a daycare. A test audits every recorded title and every answer in the measured set.
- Five missed emergencies, as small additions to existing classes: "co alarm beepin",
  "gas oder in bsmt" (more misspellings and shorthand), a dog walker who fell into a sinkhole,
  a crane tipping over, train doors closed on a woman's arm and dragging her.

## [1.2.0-beta.16] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 15, 2026-11-09: four missed emergencies in classes the server had)

- **Danger words are read through typos** (`fuzzyDangerWords`): a word of 4 letters or more one
  edit from a danger keyword (smell, smoke, fire, bleeding, breathing, unconscious, choking,
  drowning, overdose, seizure, stabbing, shooting, overboard, ...) is read as it, unless it is a
  real English word (a list generated from the system dictionary: "cooking" is not "choking",
  "parking" is not "sparking"); plus common misspellings ("smel", "gass", "fyre", "bleding",
  "siezure"). "smel gas in hallway real strong" now leads with the gas 911 line.
- **Each danger class widened** to its nouns and verbs in every tense and voice: a vehicle that
  hit, struck, ran over, plowed into, drove into or jumped the curb into people or a crowd;
  someone over, outside or on the outside of a railing or ledge, or about to fall or jump;
  anyone overboard; anything "is burning" (not a body part); smoke from a home, a hallway or a
  grate, never quieted by a recurrence word; a carbon monoxide alarm "in the hallway" going
  off, or carbon monoxide leaking (not a detector chirping for a battery).
- **Ordinary complaint with a 911 lead:** "stomp like they're trying to break through the
  ceiling" is noise, not a break-in. Slang ("this place is fire") is not a fire.
- **Generator test** (`test/danger-generator.test.mjs`): 557 phrasings across 13 danger classes
  (subjects x verbs x places x tense), each class at least 30, all must lead with 911; and 56
  ordinary near misses, none may. On beta.15: 112 generated emergencies missed and 2 near
  misses flagged; now 0 and 0.
- **Measured** on 971 phrasings (rounds 6 to 16): on beta.15, 4 missed emergencies, 1 ordinary
  complaint leading with 911 and 1 wrong answer rated strong; now none.

## [1.2.0-beta.15] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 14, 2026-11-09: three missed emergencies, five small wrong answers)

- **Weapons, any kind, anywhere:** a blade or a gun being swung, waved, pointed or shown, and a
  blunt object (a bat, a pipe, a hammer, a bottle, a chain) swung at or used against people.
  Selling or displaying weapons is not a danger.
- **Heights:** a worker dangling, stuck or swinging off a building or scaffold after something
  broke is a danger; a worker simply working is not. Someone hanging from a pipe, a beam, a
  rope or a ledge is a danger.
- **Someone in a hole or a collapse** (new class `fell_in`): fallen into a manhole, a trench, a
  shaft, a sinkhole; trapped under rubble; crushed or pinned by something falling. A dropped
  phone or keys is not. Under a danger the hazard's repair complaint is never the answer.
- **Shorthand and typos** a worried person types are read for danger words ("kid in strt",
  "baby not breathng", "guy w gun lobby", "cant get up").
- **Figures of speech:** "drowning in" anything but water, "fire sale", "choking on the dust",
  "the heat is killing us" are not emergencies.
- **Small wrong answers:** an animal in the trash → Wild Animal; a kid's (yellow) bus → School
  Bus Complaint, not the MTA; a place that is not a home (a rec center, a school, a library, a
  hospital) never gets a residential housing article, and a rec center or public pool problem
  is Park Maintenance; "a car parked outside" playing music is Noise from Vehicle, not Illegal
  Parking; construction noise on a scaffold is noise, not a scaffold complaint.
- **Measured** on 921 phrasings (rounds 6 to 15, with the report's 50 and 60 new: weapons, work
  dangers, figures of speech, non-residential places and typo fragments): on beta.14, 20 missed
  emergencies, 6 ordinary complaints leading with 911 and 14 wrong answers rated strong; now
  none.

## [1.2.0-beta.14] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 13, 2026-11-09: three missed emergencies)

- **Medical symptoms in a person, in plain words** (new danger class `medical_symptoms`):
  chest pain or pressure ("feels like an elephant is sitting on it", "clutching his chest"),
  pain going down an arm, can't breathe, talk or lift an arm, slurred or garbled words, a
  drooping face, a seizure or shaking all over, choking, severe bleeding, lips turning blue,
  swelling after eating, wheezing with an inhaler that isn't working, overdose signs, a head
  injury with vomiting or confusion. Never an animal ("my dog is choking"), a figure of speech
  ("feel like I'm having a heart attack"), stress, or a complaint about dust or fumes.
- **A child with a hazard, now** (`child_hazard`): a child, toddler, baby or kid in or between
  traffic, left in a car, in distress in water, on a ledge or windowsill, alone at a platform's
  edge or near a fire. A habit or a child playing safely is not.
- **Water in every setting:** pools, bathtubs, beaches, ponds, a ferry or a pier, a current;
  someone held under water is both a water danger and violence.
- **Under a detected danger, a follow-up article must fit it** (share the danger's words or be
  its City article) or is left out: a gas hiss "from the meter" no longer gets Parking Meter
  Complaint. "A heart attack" is no longer read as an attack.
- Also: a clogged sewer grate → Catch Basin Complaint; recycling nobody collected → Missed
  Collection; a squirrel stuck in a chimney → Wild Animal; expired food at a store → Food
  Safety; graffiti on a mailbox → Graffiti ("block" and "blocked" are different words now);
  beer cans in a playground → Park Maintenance.
- **Measured** on 811 phrasings (rounds 6 to 14, with the report's 50, 60 new emergencies and
  15 near misses): on beta.13, 30 missed emergencies, 3 ordinary complaints leading with 911
  and 3 wrong answers rated strong; now none.

## [1.2.0-beta.13] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Changed: one sentence on every response (Noel, beta round 13)

- Every response from all 21 tools, success or error, now carries the exact sentence "If this
  is an emergency, please call 911.": first in the text, and as the first field
  (`safety_line`) of the structured answer. It replaces beta.12's longer line, which was only on
  the three reporting-help tools. A detected danger still leads `how_to_report`'s and
  `draft_311_report`'s `first_line` with its own, stronger 911 line. A test calls every tool.

### Fixed (beta retest 12, 2026-11-09)

- **Missed emergencies, by class:**
  - violence between people in the present tense: any of beating, hitting, punching, choking,
    stabbing, attacking, dragging or shoving a person ("a man is beating a woman in the
    stairwell"); domestic violence with any relationship word. Violence never gets a building
    repair article (it had got Heat or Hot Water);
  - someone at a height who may fall or jump (a bridge railing, a roof's edge, a ledge, a
    window, scaffolding), with the general danger article. The 988 line still comes only from
    the City's Suicide article, when the person's words are about suicide. Window washers and
    harnessed workers are not a danger;
  - water rising where people are (a flooded basement or underpass with people inside);
  - a vehicle out of control now (spinning out, sliding, driving on the sidewalk). A habit
    ("cars always skid on this hill") is not.
- **Medical danger words are for people.** An animal hurt or hit by a car goes to Injured or
  Sick Animal; a figure of speech ("yowls like it's being hurt", "killing me", "like a bomb
  went off") is not a danger. A person hurt in the same sentence still is.
- **Wrong strong:** a broken TV on the sidewalk → Illegal Dumping. A TV, stereo or speakers
  count as noise only with a sound word.
- **Regression: Parkway.** The round-12 highway rule matched every parkway, so a pothole on
  Eastern or Ocean Parkway got no draft. "Parkway" alone is now a city street; only named
  expressway-type parkways (Belt, Cross Island, Grand Central, Jackie Robinson, Hutchinson
  River, Henry Hudson, Bronx River, Korean War Veterans, Shore, ...) and expressways,
  interstates and ramps are highways (`HIGHWAY`).
- Also: a street never plowed → Snow or Ice on Street or Highway; a rusted fire escape →
  Apartment Maintenance; leaf blowers → Noise from Lawn Equipment; a business next door is not
  a neighbor; hot weather is not a heating complaint.
- **Measured** on 687 phrasings (rounds 6 to 13, with the report's 35 and 60 new ones on
  violence, heights, floods, vehicles out of control, injured animals, figures of speech and
  Parkway/Expressway/Boulevard/Bridge street names): on beta.12, 16 missed emergencies, 3
  ordinary complaints leading with 911 and 6 wrong answers rated strong; now none.

## [1.2.0-beta.12] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Changed: the safety design (beta retest 11, 2026-11-09: eight missed emergencies)

- **Defense in depth.** Every `how_to_report`, `list_311_categories` and `draft_311_report`
  answer now starts its text with one fixed line, before the JSON, and carries it as
  `safety_line`: "If someone is hurt or in danger right now, call 911. This tool can miss an
  emergency." Detected dangers still lead `first_line` with their own 911 line.
- **Asymmetric danger rule.** The recurring rule (beta.11) never switches a danger off when
  anything in the description says it is happening now ("now", "just", "isn't moving", "won't
  wake", "filling with", "people inside", "trapped", "help", or a danger verb in "is ...ing").
  Smoke from an outlet, wiring, an appliance, a battery, an e-bike, a space heater or a boiler
  room is never switched off.
- **New danger classes, said in general ways:** a person hit by a vehicle, either way round
  ("a bus hit a cyclist", "a pedestrian was struck by a car", "got doored"); someone calling
  for help; someone on or pushed onto the subway tracks; someone through the ice; someone
  trying a door or punching people right now; a car flipped with people inside; an arm stuck in
  train doors. Near misses ("almost hit") and habits (people walking on the tracks, a fire alarm
  that goes off when someone cooks) are not.
- **Someone hurt never goes to a social-service article** (homeless outreach, shelters,
  encampments). Beta retest 11: an injured cyclist got Homeless Outreach Assistance.

### Fixed

- Wrong answers rated strong: screaming for help → the danger article, not Noise from Neighbor;
  pushed onto the tracks → 911; an abandoned building → Vacant Building Complaint, not
  Abandoned Vehicle; a dumped mattress with bed bugs → Illegal Dumping; a dead bird on a fire
  escape or a roof → Dead Animal on Private Property (an information page, so not strong); lead
  paint → Lead Paint. Also: potholes on a highway ramp, double parking, dog waste, a gym
  membership, a dry cleaner, a dog run's gate.
- **Measured** on 593 phrasings (rounds 6 to 12, with 80 new: emergencies and near misses in
  transit, traffic crashes, water and ice, crimes in progress, medical, calls for help and
  recurring-but-now, plus 20 ordinary complaints): on beta.11, 19 missed emergencies, 2
  ordinary complaints leading with 911 and 7 wrong answers rated strong; now none.

## [1.2.0-beta.11] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 10, 2026-11-09)

- **A recurring condition is not an emergency in progress.** "black smoke pours out of the
  chimney next door every morning" and "a man sleeps passed out on a bench in the park every
  night" led with 911. Now a recurrence word ("every morning", "always", "keeps ...ing", "for
  weeks") quiets the ambiguous dangers (smoke, a crash, someone passed out or not moving, a theft
  or break-in that keeps happening) unless something says it is happening now ("right now",
  "not breathing", "won't wake up"). Fire, gas, carbon monoxide, bleeding, not breathing and
  weapons are never quieted. The assessment reports `recurring`. 20 now/recurring pairs are
  tested.
- **A crime that is over does not lead with "Call 911".** A matched City article whose summary
  says "Call 911" (Criminal Mischief, Stolen Property, Burning Garbage, Hate Crime) no longer
  leads for a pattern that recurs, or for a crime told as done ("someone keyed my car",
  "smashed ... overnight"); the article and its 911 text stay in the answer, with the crime
  pointer (precinct, Crime Stoppers). Thefts and break-ins in progress ("stealing packages
  right now", "breaking car windows right now") now lead with 911.
- **Wrong answers rated strong:** a smashed car window and a stolen bag → Criminal Mischief and
  Stolen Property ("my parked car" names a car, not a parking problem; a car window is not an
  apartment window); spray-painted threats → Graffiti (spray paint and tags are graffiti, not
  paint repairs). Also: a boiler chimney's smoke is Chimney or Ventilation Smoke; crashes that
  keep happening at a corner are a traffic condition; someone sleeping in an elevator or on a
  bench is homeless outreach.
- **Misses:** a daycare with no heat → Child Care Complaint (the Consumers and Early Childhood
  lists are now recorded); peeling lead paint → Lead Paint; a security deposit → Rent Security
  Deposits and Interest; a store overcharge → Overcharge; a tow company → Tow Truck Complaint;
  burning garbage → Burning Garbage.
- **Alternatives:** "park" no longer matches "parking" or "parked", and a "Call 911" article is
  lifted under a danger only when it is the danger's own article (no Cannabis Sale Outside under
  a gun threat).
- **Measured** on 458 phrasings (rounds 6 to 11, with 60 new ones mixing recurring and
  in-progress framing, past and in-progress crimes, and property damage): on beta.10, 9 wrong
  answers rated strong, 3 missed emergencies and 4 ordinary complaints leading with "Call 911";
  now none. Requiring the person's own words in the article was measured and not adopted: it
  dropped 81 (one word) or 229 (two words) right answers from strong and caught nothing more.

## [1.2.0-beta.10] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 9, 2026-11-09)

- **Missed emergency: forced entry.** "someone is trying to break down my front door right now"
  got Apartment Maintenance and no 911. The crime-in-progress danger now covers forced entry
  (breaking, kicking or forcing a door or window), an intruder inside, someone trying to get in,
  and being followed. A landlord trying to get in is not a danger.
- **Someone in the water is its own danger** (fell, jumped or slipped into a river, the ocean,
  a pool; drowning; struggling in the water), leading with 911; a dropped phone is not.
- **Sensitive articles match only on their own words.** "a child fell into the river and is
  struggling" best-matched the City's Child Pornography article on the word "child". Articles on
  abuse, sexual crimes and harassment, exploitation, trafficking, suicide, hate crimes, overdose
  and minors (`SENSITIVE_ARTICLES`) are now left out unless the description uses their own
  words; a test fails if any recorded article of that kind has no guard.
- **Wrong answers rated strong:** bees on a tree → Bees or Wasps Complaint (the tree entry no
  longer adds "branch"); a rat in the subway → Buses and Subways (the MTA takes "rats and other
  animals at MTA locations"); tree roots lifting a sidewalk → Broken Sidewalk; a walk signal →
  Pedestrian Signal Complaint or Request; a neighbor feeding pigeons → Pigeon Droppings or Odor.
  Also fixed: lockout by padlock, cutting off electricity to force a tenant out, or removing
  belongings → Illegal Eviction or Lockout; drag racing and burnouts, sewer smell, brown tap water,
  low water pressure, curb ramps, a crumbling sidewalk, building without a permit, a smoke alarm
  with a low battery, a fallen tree on a parked car.
- **Confidence: strong is rarer where it was being wrong.** An information page with nothing to
  report (`isInfoOnly`) is never strong; neither is an article from another domain than the one
  the person names (`domainMismatch`: a school, a ticket, immigration, a benefit, taxes, a
  voucher, insurance, the ferry, an ambulance). "Emergency" in a program's name ("emergency
  rental assistance") is no longer read as urgency.
- **A no-match first line is its own sentence:** "No 311 article matched this description. If
  anyone is in danger right now, call 911." The emergency line is unchanged.
- **Measured** on every phrasing from rounds 6 to 10 plus 60 new ones across transit, schools,
  tax and finance, pets, construction, health, consumer, immigration and benefits (390): on
  beta.9, 11 wrong answers rated strong, 2 missed emergencies and 1 false 911; now none. The
  measurement runs in the test suite (`test/phrasing-sets.mjs`).

## [1.2.0-beta.9] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 8, 2026-11-09)

- **A loud party no longer says "Call 911".** No danger was detected: round 8's party entry
  searched for "party" and "crowd", which made Noise from Large Party or Crowd (KA-01591, whose
  only text is "Call 911 to report a large, loud party that has potential for danger") the
  strong best match, and a strong best match whose summary says "Call 911" led the answer. Now
  a "Call 911" summary that is conditional ("potential for danger", "in progress", ...) leads
  only when a danger was detected in the person's words, and such an article is never rated
  strong without one; an unconditional one (Illegal Eviction or Lockout, Drug Sale) still
  leads, except for a crime the person says is over. A party is searched as noise, so a
  neighbor's party is Noise from Neighbor and a street party Noise from Street or Sidewalk.
  Also: a building fire alarm that keeps going off for no reason, and a dog that attacked a
  cat, are no longer 911 cases. 35 ordinary complaints that must never say "Call 911" and 12
  emergencies that must are in the tests.
- **Wrong answers rated strong:** a landlord lockout → Illegal Eviction or Lockout (KA-02518,
  the City's own "Call 911" line); a car parked in a bike lane, crosswalk or bus stop → Illegal
  Parking (KA-01986), not Bike Lane upkeep. The report's other misses now have their City
  article: helicopter, manhole cover, faded crosswalk paint, snow on a sidewalk, a missed bulk
  pickup, taxi, rooster, raccoons, a bus that never came, Citi Bike, a stolen package (no 911
  line: it is over), internet provider. "flies" as a verb is no longer insects.
- **Emergency answers' confidence.** When the best match is the City's article for the
  danger detected, it reads "strong: the City's own article for the danger detected; call 911
  first". Otherwise `confidence_note` says the rating is for the 311 article as a follow-up.
  Danger words now count as separate evidence, as in round 8's facets.
- **`ll47_directory_assistance_report`: the first fiscal-year call answers in time.** The
  ~12 s answer wait started after the dataset metadata request (about 4 s that morning; the
  call took 16.0 s). It now counts from the start of the call. If the metadata is not in by
  then, a saved copy of it answers; with none saved, the answer says the months are loading,
  and the load starts in the background when the metadata arrives.
- **Stress set, round 9:** 40 new phrasings weighted to near misses. Before: 19 wrong (8 rated
  strong or with a wrong 911 line), e.g. a restaurant with rats → Rat or Mouse, a tree that
  needs pruning or a bike chained to a tree → Fallen Tree, food poisoning from a cart →
  Street Vendor, a boiler banging → Heat. Now none.

## [1.2.0-beta.8] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 7, 2026-11-09)

- **`how_to_report`: right answers back to "strong".** Round 7 counted each word-list entry as
  one piece of evidence, which also merged entries whose words are different facets of one
  problem ("skipped our garbage pickup" adds missed + collection). Missed garbage pickup,
  rodents in my building and a homeless person who needs help dropped to "close call". Now
  only entries whose words are synonyms ("dirty" / litter / trash; odor / smell; elevator /
  escalator; snow / ice) count once; a dirty bathroom at home and a carbon monoxide detector
  stay as fixed in beta.7.
- **`ll47_directory_assistance_report`: the try count climbs and the limit holds.** The count
  lived in each background load and restarted at 1 with every new one, and a try cut short by
  a load's time limit was not counted, so July failed six times and every answer said "try 1
  of 4". Now it is kept per month for the life of the server and cleared on success; after 4
  failures in a row the month rests 10 minutes (`DA_REST_MS`), asking nothing, and says until
  when.
- **Routes** (City text recorded 2026-11-09, read-only): smoke detectors "never installed" →
  Apartment Maintenance Complaint; dogs off leash → Unleashed Dog (KA-01051, category Pets now
  searched); a stray animal → Stray or Abandoned Animal; an aggressive animal or one attacking
  people → 911 first with the City's Dangerous Animal line (KA-01538), not for an animal that
  bit a pet; subway stations, cars and MTA buses → Buses and Subways (KA-01014), agency the
  MTA (an "Authority" named in an article's text is now read as its agency); a car alarm stays
  Noise from Alarm, now strong; a broken elevator → Elevator or Escalator Complaint, strong,
  not the inspector or inspection articles; a streetlight out → Street Light Complaint, strong.
- **Stress set, round 8:** 43 new phrasings. Before: 10 wrong best matches or none (2 rated
  strong): mice in a kitchen → Rat or Mouse; eviction threats → Heat or Hot Water; a hydrant
  spraying water → Water Leak on Street; a dirty subway car → Litter Basket; nothing for a
  howling dog, a DJ party, revving motorcycles, a dead pigeon in front of a house, a car sitting
  for a month, or a dog off its leash on the block. Now none. Every danger case leads with 911.

## [1.2.0-beta.7] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 6, 2026-11-09)

- **`ll47_directory_assistance_report`, fiscal year: a failed month no longer stops the load.**
  On the home Mac a month got a 503, its one quick retry failed too, and the call reported
  the error, marked the later months "not tried", and the load only restarted on the next
  call (5 of 16 calls). Now the load goes on to the next month and asks the failed one again
  later, at most 4 times, pausing before each request after a failure (3 s, doubling with each
  failure in a row, up to 30 s; a success resets it). Still one request at a time
  (engineering standards §6), the 12 s answer wait, and the 4-minute background limit. A
  month waiting for its next try says "retrying: … (try n of 4)". The pause timer never keeps
  the process alive, so the server still exits when its stdin closes.
- **The month in progress is no longer cached forever.** November grew by 4,861 calls while
  the dataset's `rowsUpdatedAt` stayed the same, so an older saved copy answered FY2027 as
  1,264,433 and a fresh one 1,269,294. A month not yet settled (the month in progress, and
  the month before it for 7 days after it ends) is now asked again when its saved copy is
  more than an hour old (`OPEN_MONTH_TTL_MS`), whatever the dataset's timestamp. Settled
  months keep the 30-day rule. If the new copy is not in by the answer, the older one
  answers, labeled. A new `recent_months` field says when each recent month was fetched.
- **`how_to_report` / `draft_311_report`: wrong routes rated "strong".** "bathroom in my house
  is dirty" got Litter Basket Complaint; "landlord didn't install a carbon monoxide detector"
  got Vehicle Stored on Residential Property. Cause: confidence counted the person's problem
  words one by one, and one word-list entry adds several ("dirty" adds litter and trash), so
  one word read as two pieces of evidence; and a match resting only on context words ("car"
  inside "carbon", "residential" from "landlord") could be strong. Now evidence counts once
  per entry and must include the problem itself. A detector the landlord did not install,
  never installed or won't replace goes to Apartment Maintenance Complaint (KA-01074, HPD),
  whose City text says owners must install smoke and carbon monoxide detectors. Dirt in a
  room at home is offered there as a possible match only. Word fixes: "carbon" is not a car,
  "tenant" is not a tent, "yellow" is not yelling, "ice cream" is not ice, roaches are not
  rats, water gushing from a hydrant is a hydrant (not a water main), and "smoke detectors in
  the building" is not a Smoke Free Air Act complaint.
- **Stress set.** 68 realistic phrasings across housing, noise, street, parks, sanitation,
  vehicles and safety, with near misses, run offline in the tests. Before this round 7 of
  them were wrong, 6 rated strong; now none. Every danger case still leads with 911.

## [1.2.0-beta.6] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 5, 2026-11-09)

- **Park restrooms** (`how_to_report`, `draft_311_report`). A restroom, bathroom, toilet or
  comfort station in a park, playground, beach, pool or recreation center that is locked,
  closed, dirty or broken goes to Park Maintenance Complaint (KA-01060, Parks), whose City
  text covers "unclean conditions" and a park facility "closed to the public during posted
  hours". Before, "public bathroom in the park is locked" got Breaking Park Rules and "the
  playground bathroom is dirty" got Unlocked Park or Playground. A bathroom at home is
  unchanged.
- **Agency named in an article's text.** A possessive is no longer part of the name:
  "Department of Housing Preservation and Development's (HPD)" (the Carbon Monoxide
  article) now reads "Department of Housing Preservation and Development (HPD)". Fixed for
  every article, straight or curly apostrophe, singular or plural.
- **`ll47_directory_assistance_report`, fiscal year: a failed month is retried at once.**
  When a month an earlier call started loading fails (or was "not tried" after one did),
  the next call retries those months within its own 12 s answer, still one request at a
  time (engineering standards §6). Before, that call only reported the failure and the load
  restarted on the call after. A month the call itself tried is still not asked twice.
- **`ll47_directory_assistance_report`, partial answer.** An incomplete period still has no
  `calls` total, and says the full total is not ready yet. It now shows `saved_months` (each
  saved month's calls and Directory Assistance topic calls) and `saved_months_so_far`, their
  sum, labeled "Saved months so far (n of m): a partial sum, not the total for the period".

## [1.2.0-beta.5] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 4, 2026-11-09)

- **`ll47_directory_assistance_report`, fiscal year.** A `fiscal_year` call now answers
  within about 12 s. Saved months answer at once. Months not saved are fetched one at a
  time (never in parallel to one portal, engineering standards §6); any not done after 12 s
  are listed as "still loading … ask again in a minute", keep loading after the answer, and
  are saved when they land (up to 4 minutes in all). A second call waits on the same request
  instead of sending another. No total is given until every month is in. Before, the first
  call waited about 55 s on one slow month.
- **Water outdoors** (`how_to_report`, `draft_311_report`). Indoor and outdoor words decide.
  Water leaking from a street or sidewalk goes to Water Leak on Street or Sidewalk
  (KA-01234, DEP; recorded as a test fixture); a water main break, or water gushing down the
  block, to Water Main Break (KA-01233); a leaking or open hydrant to Fire Hydrant Complaint
  (KA-01034); water pooling in the road to Street Flooding (KA-02198). Any indoor word ("my
  ceiling", "into my apartment", "the hallway of my building") keeps Water Leak in a
  Building (KA-01509).
- **Confidence.** One problem word shared by several titles is strong again when it names
  the article: more than half of the article title's words are the person's, and it scores
  3 or more above every other title with that word. "No heat in my apartment" and "illegal
  fireworks every night" are strong again; "construction" alone, or "construction site"
  for the Construction Site No Smoking Sign article, is still not.
- **Exit on close.** The server now exits as soon as the app closes it, instead of staying alive while fiscal-year months load in the background. Cache files are written to a temp file and renamed, so nothing is left half-saved; an unfinished month loads again next time.
- **Version.** The server reports `1.2.0-beta.5`.

## [1.2.0-beta.4] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 3, 2026-11-09)

- **`ll47_directory_assistance_report`, one month.** A one-month call now fetches only
  that month. Its fiscal year to date uses the months already saved, and lists the others
  as "not fetched" with a pointer to `fiscal_year`. Before, a call for a saved October still
  waited about 55 s on the other fiscal-year months. A `fiscal_year` call fetches every
  month, answers saved months at once, and lists slow ones as missing. A month that cannot
  be refreshed in a call is answered from its older saved copy, when there is one.
- **Reporting matches** (`how_to_report`, `draft_311_report`), all on the City's own
  articles, recorded as test fixtures: jackhammering or construction outside the allowed
  hours goes to Noise from Construction (KA-01091), not Construction Site No Smoking Sign
  Complaint; a bus stop shelter to Bus Stop Shelters (KA-01071) and its complaint option; a
  street or food vendor, or selling on the street without a permit, to Street Vendor
  Complaint (KA-02152); a dead animal on a sidewalk or street to Dead Animal on Public
  Property (KA-02245), with Rat or Mouse Complaint still offered for a dead rat. A street
  sign that was knocked down picks the "Fallen, Dangling, or Leaning" option.
- **Confidence.** "Strong" now needs two of the person's problem words in the article's
  title or summary, or one word that at most two titles in the searched categories share.
  One common shared word ("construction") is no longer rated strong.
- **Agency never blank.** When 311 lists no report option, the agency is the one the
  article's own text names (Bike Lane, Traffic or Bicycle Signal: the Department of
  Transportation). When the options go to more than one agency and the words pick none
  (Water Leak in a Building, Snow or Ice on Sidewalk), it says "depends on which report
  option fits; see agencies". When the City names none, "agency not listed by 311". A new
  `agency_source` field says which.
- **Version.** The server reports `1.2.0-beta.4`.

## [1.2.0-beta.3] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 2, 2026-11-09)

- **ZIP guard false positive** (blocking). `ll47_directory_assistance_report` for FY2027
  failed with "A ZIP code was about to be returned": a timeout reason said "within 30000
  ms", and the guard read the number as a ZIP code. Now a five-digit number with a unit
  after it (ms, seconds, requests, calls, rows…), a dollar sign before it, or a decimal
  point is a quantity, unless a state, borough or "ZIP" comes first. Timeouts are said in
  seconds. And the last check on every answer now removes a ZIP-looking number and goes
  on, instead of throwing the whole answer away; ZIP codes in City text are still removed,
  and a key that names a ZIP code is still refused.
- **`ll47_directory_assistance_report` when NYC Open Data is slow.** The City's dataset was
  slow, not down (a month took 40 to 74 s). Each month is now one lighter query (grouped by
  topic only, with counts of filled agency and call_resolution); the full breakdown is
  asked only for a month that has them. A request may take up to 55 s, inside a 58 s
  budget, and a timeout is not retried. The message says "NYC Open Data is slow right now"
  after a timeout and "not responding" only after an HTTP 5xx or no connection.
- **Reporting matches** (`how_to_report`, `draft_311_report`), all on the City's own
  articles, recorded as test fixtures: rodents in a building go to Residential Pest
  Complaint (KA-02278); trash in a lobby, hallway or basement to Apartment Maintenance
  Complaint (KA-01074); no water to No Water, Low Water Pressure, or Water Temperature
  Complaint (KA-01405), not Heat or Hot Water; a stop, street, traffic or parking sign to
  Street Sign Complaint (KA-01063); an idling vehicle or an engine left running to Idling
  Vehicle (KA-02222). A car alarm stays Noise from Alarm (KA-01089), with Noise from Vehicle
  offered as an alternative. All 23 phrasings of the retest table are a regression test.
- **`get_service_request_list` not found.** When the City finds none of the numbers, one
  plain sentence and the same hint as `get_service_request`, not the City's raw 404 text.
- **Version.** The server reports `1.2.0-beta.3`.

## [1.2.0-beta.2] - 2026-11-09

Still a beta on the `beta` branch; not published to npm.

### Fixed (beta retest 1, 2026-11-08)

- **Reporting matches** (`how_to_report`, `draft_311_report`), all on the City's own
  articles: a standing dead or dying tree goes to Dead Tree (KA-02006), not Fallen Tree or
  Branch; a skipped or missed garbage or recycling pickup goes to Missed Trash, Recycling,
  or Compost Collection (KA-01788), not Litter Basket. New words for parking meters
  (KA-01240), street flooding (KA-02198), sidewalk sheds and scaffolds (KA-02291), bed bugs
  (KA-01236) and food poisoning (KA-02051). Trash inside a building is no longer a litter
  basket. 20 everyday phrasings are regression tests. The 911 rules are unchanged.
- **Danger in `details` or `when`, offline** (`draft_311_report`). With no key or 311
  down, danger written only there gets the City's built-in line for that danger (the gas
  line, say), the same as danger in the description, instead of the generic line and a
  missing-key error.
- **`list_311_categories` past the end.** An offset past the last article says so: "Offset
  500 is past the end: there are 42 articles, 20 per page, so pages 1 to 3 (offsets 0, 20,
  40)."
- **`get_service_request` not found.** One plain sentence and the hint; the City's raw
  error body is no longer shown. A request id the API sends is kept.
- **`get_status`** adds a `plain_language` block to the API's answer: yes or no in words,
  what the status checks (the City's description from the 311 API portal), when it was
  asked, and a pointer to `get_calendar` for alternate side parking.
- **`ll47_service_request_report` cut list.** "Showing 5 of 20 areas (18 community
  districts and 2 Joint Interest Areas)", not "20 districts".
- **`ll47_directory_assistance_report` outage.** Two tries at most per request, and no
  retry after a slow failure, so an NYC Open Data outage is reported in seconds rather than
  after 45. The message says NYC Open Data is not responding and suggests trying later or
  asking for the fiscal year.
- **Version.** The server reports `1.2.0-beta.2`.

## [1.2.0-beta.1] - 2026-11-08

A beta, installed from the `beta` branch (`npx -y github:BetaNYC/nyc-311-mcp#beta`). Not
published to npm; the released package stays at 1.1.0. Everything below this heading, down
to 1.0.1, is in this beta.

### Fixed (beta test round 1, 2026-11-08)

From a test of all 21 tools on a second Mac (106 calls):

- **District codes.** `community_district` accepts board codes and names as well as
  BoardStat's number: `309`, `BK09`, `bk9`, `Brooklyn 9`, `Brooklyn CD 9`, `Brooklyn
  Community District 9`, `Kings 9`. A form it cannot read gets a plain error with the
  accepted forms and an example. `council_district` accepts `Council District 7`.
- **Fair year-over-year numbers** (`top_problems`, `problem_trend`). With a `status`
  filter there is no year-earlier comparison: the data has each request's status today,
  not a year ago, so open-now against year-old requests that are open now is not like for
  like (the test saw "+18,100%"). A year-earlier count under 30 shows both counts and
  `change_note: "small numbers; percent change not shown"` instead of a percent.
- **Reporting matches** (`how_to_report`, `draft_311_report`), all on the City's own
  articles: graffiti goes to Graffiti (KA-02070), with the section that fits quoted (USPS
  Mailbox); rats in a park go to the Parks report option, not HPD's at-home form, and the
  place named (park, sidewalk, school, highway, home) picks the option in general; park
  equipment (a bench, swings, a fountain) goes to Park Maintenance Complaint (KA-01060), so
  "a trash can and a broken bench" lists both; a grill goes to Barbecuing (KA-02228), the
  closest the City has, and because its only report option is for parks, a neighbor's grill
  gets "no exact match" and the closest articles, not a draft. 25 everyday phrasings added
  to the tests; the 911 rules are unchanged.
- **Built-in 911 lines.** With no API key and an empty cache, "I smell gas" now leads with
  the City's own gas line (KA-02048), built in from the 2026-11-07 recording, and no draft.
- **Names.** Street, neighborhood and park names ("Gun Hill Road", "Crown Heights") no
  longer set off "This draft names someone"; a person's name still does.
- **Plain errors.** Argument errors are sentences (which argument, what was wrong, the
  allowed values), not zod JSON. An empty `sr_numbers` list is refused before any request.
- **Rate limits.** `get_service_request` asks `GetServiceRequestList` for the same number
  when the single lookup is rate limited (HTTP 429); the portal documents that the two
  return the same request. Other 429s are retried twice at most, honoring `Retry-After`,
  with no more than 20 s of waiting; the error says how long to wait.
- **Truncation in words.** `ll47_service_request_report` with `by_district` says "Showing 5
  of 18 districts, because limit is 5" when `limit` cuts the table.
- **Smaller answers.** `list_311_categories` with no arguments is a summary (33,050 to about
  7,600 characters); a category's articles come 20 at a time with `offset` and `next_page`.
- **Open Data outages.** `ll47_directory_assistance_report` stops at the first failing month
  instead of spending its whole 45 s budget, with a plain "try again in a few minutes".
- **Version.** The server reports `1.2.0-beta.1`, so a tester can tell the beta from 1.1.0.

### Added: draft a 311 report (Phase 5, #18; closes #10)

- `draft_311_report`: a short ready-to-paste report the person submits themselves (problem,
  where, when, what they saw, details), the 311 Online article link, `[add: …]` placeholders
  and questions for anything missing (nothing is made up), what the article says the report
  needs, about contact details and about photo attachments (quoted; nothing claimed the
  article does not say), what happens next, and the status lookup (`get_service_request`,
  311 Online's "Look Up Service Requests", `portal.311.nyc.gov/check-status/`). **Files
  nothing, sends nothing, fills no form, never calls the Developer Partner product.** The
  City does not publish each form's fields, and the answer says so.
- Matching, emergencies, splitting and articles come from `how_to_report` (called, not
  copied). No draft whenever `assessDanger` flags danger in the whole description or any
  part; the answer is how_to_report's own 911 answer (with its 988 and domestic violence
  text). Every answer starts with `safety_line` and `assistant_instruction`, and every error
  with the safety line, including argument errors through the tool handler. A description
  of several problems gets one draft each (`splitProblems`). An article whose summary says the City
  does not take the complaint gets no draft and the City's words.
- Problem Detail options and response times from NYC Open Data's 311 Service Level
  Agreements (`cs9t-e3x8`), labeled with its last update, 2024-03-05. Read whole (about
  3,600 rows; one metadata and one rows request), cached 30 days, then rechecked by
  metadata; a stale copy answers when the portal is down, and without one the draft is made
  without options. A Problem Detail goes into the draft only when the article's report
  option and the person's words both name it; a guess from the words is a question.
- No draft when no article matches: how_to_report's no-match answer, 911 first. Every part of
  a several-problem description is listed (a draft, or "couldn't match this part").
- Privacy: email addresses and phone numbers in the person's words are left out unless they
  pass `include_contact`; any ZIP code is left out with its "zip" label; a note when the
  words seem to name someone; nothing is stored or logged.
- A time or recurrence plain in the description ("at 2 am", "every night") goes into When:.
- Phase 4 follow-up: hopelessness phrasings ("if I disappeared", "better off without me",
  "nobody would miss me", "can't go on") lead with 911 and the City's 988 text.
- Reviewed on the 20 common problem types and 10 harder cases (`docs/draft-a-report.md`,
  `scripts/draft-report-review.mjs`). Testing with real people is still to do.

### Added: help reporting a problem to 311 (Phase 4, #17)

- `how_to_report`: from a plain description, the best 311 article (title, KA number, link
  on 311 Online) and up to four others, with the agency and 311 problem type the article names
  (NYC Open Data's `complaint_type`), what happens next, what the City says it does not
  handle, and the ways to report. All of it is City text: the article, and for the NYC311
  app, phone 311 / 212-NEW-YORK and text 311-692, portal.311.nyc.gov/about-nyc-311/ (read
  2026-11-07). When the description suggests danger, `first_line` is the City's own
  "Call 911" summary. Optional district: how often that problem type was reported there
  (`problem_trend`). It files nothing.
- `list_311_categories`: 311's categories, or one category's articles.
- `src/content-311.ts`: client for the API's GetCategory, GetContentList and GetContent,
  built from the portal's operation list and checked against live responses (several
  differ from the documented schema). Disk cache, 7 days, with a stale copy when the API
  is down; one request at a time, 1 s apart, 30 s timeout, one 429/503 retry.
- Matching is deterministic keyword scoring over the articles of a few routed categories
  (`CONCEPTS` in `src/how-to-report.ts`). Reviewed on the 20 most common problem types:
  the right article 20 of 20; the article names the open-data problem type in 14
  (`docs/how-to-report.md`).
- QA round 1 on #23 (safety first): `src/emergency.ts` (`assessDanger`, `emergencyLead`,
  `SAFETY_LINE`, `CITY_988`, `CRIME_POINTER`) detects many more dangers and leads with 911;
  a City "Call 911" article is quoted only when it is the danger detected, otherwise BetaNYC's
  own line, labeled. Every answer carries `safety_line`. Negation, smoking, odors and past
  crimes do not lead with 911. 988 for suicide (from KA-01635). `crime` pointer to the City's
  articles. `other_problems` for several problems; Spanish keywords with `language_help`;
  one-edit typo correction (`spelling_corrected`). New concepts (harassment, fire escape,
  broken detector, broken sidewalk, elevator, fireworks, missed collection, crash, smoking).
  Article date in every answer; time-sensitive articles refreshed daily; a missing key is named
  as such. 46 phrasings in `test/how-to-report-phrasings.test.mjs`.
- QA round 2 on #23: danger detection is keyword-based and will miss some emergencies, so
  every answer and both tool descriptions carry `assistant_instruction` telling the calling
  assistant to send the person to 911 whenever anything suggests danger. `safety_line` is the
  first field of every answer and starts every error; every no-match answer leads with 911.
  Much wider patterns (medical, smoke and outlets, gas smell, structural, violence and
  threats, people at risk, domestic violence quoting KA-01217). "Shooting a video" is not
  gunfire. 50 emergencies and 23 look-alikes in `test/how-to-report-emergencies.test.mjs`, plus
  14 suicide and self-harm phrasings that must lead with 911 and the City's 988 text.
- QA round 3 on #23: falls from a window or roof, calls for help, swallowed objects, "ODing",
  "reeks of gas", "came crashing down", jumping in front of a train lead with 911; "gun store",
  "shot glass", "flu shot" and "sparks shooting out" are not gunfire. 34 more cases in the tests.
- Decision of 2026-11-08 on #23: "not an emergency" and "not urgent" quiet only ambiguous
  signals (smoke, a crash, water near electricity, a shaking structure), never someone hurt or
  not breathing, gas, carbon monoxide, fire, or suicide and self-harm (`HIGH_SEVERITY`). A
  past-time word no longer quiets a crime when the words say it is still going on ("still
  inside", "right now") or name a weapon. "Broke in" is a crime word; "Gun Hill Road" is not
  a gun. Cases in `test/emergency-disclaimer.test.mjs`.

### Added: request lookup by district, and statuses in plain words (Phase 3, #16)

- `find_requests`: every request in a community or council district, any status, newest
  first, with `limit`/`offset`/`next_offset`. Filters: problems, descriptions, agency,
  `status` (`closed`/`not_closed`) and `statuses` (the City's own values, such as `Pending`).
  `by_status` counts each status with a plain-language `meaning`. Checked against DuckDB
  (`Oracle.find_requests`, `expected-lookup.json`).
- `address_history` takes `offset` and returns `next_offset`; it, `still_open` and
  `find_requests` return status meanings.
- `get_service_request` / `get_service_request_list`: additive `plain_language` block per
  request (status label from the API's documented codes, meaning, resolution, submitted time,
  the address to pass to `address_history`); the list adds `not_found`, since the API leaves
  out unknown numbers silently. A 404 explains that an Open Data id is not a 311 number.
- `src/service-requests.ts`; evidence and status tables in `docs/service-requests.md`.
- QA round 1 on #22: `find_requests` and `address_history` pages carry `next_page`
  (`offset` + `data_as_of`) and refuse a page from another build, as `cb_monthly_list` does.
  `find_requests` reads the district window by window and the text columns only for the page
  (Council District 11, 2020 on, `limit: 1`: about 1.06 GB peak before, 344 MB after).
  `status` + `statuses` that cannot both hold are refused. Status meanings are labeled
  `meaning_source: "BetaNYC"` and each says the City publishes no definition.

### Changed (Phase 3, #16)

- **The 311 number is not Open Data's `unique_key`** (two matched requests, 2026-11-07; no published source links them that we found; docs/service-requests.md).
  District tools and `cb_monthly_list` now call the id `unique_key` instead of `sr_number`
  (unreleased; Phases 1 and 2 only), and their caveats say it is not the 311 number.
- **ZIP codes are now removed from the 311 API answers too** (`Address.FullAddress` ended in
  one). Values only; no field is dropped except a key naming a ZIP code.

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

### Fixed (QA round 1 on #21)

- A fiscal year cut to the data is labeled with the dates it covers ("FY2027 to date (2026-07-01
  to 2026-11-04)"), in every district tool (`resolvePeriod`).
- `cb_monthly_list`: a third part, requests unresolved at the month's end and closed since; for an
  older month the answer says "unresolved" is as of the build; pages carry `data_as_of`, and a page
  from another build is refused.
- `ll47_directory_assistance_report`: settled months are kept 30 days whatever the dataset version;
  a 45 s budget per call (the asked-for month first, the rest listed as missing); a saved copy
  answers, marked stale, when NYC Open Data is down.
- The service-request report's caveats say negative and future close times are left out.

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
