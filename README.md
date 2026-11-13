# nyc-311-mcp

An [MCP](https://modelcontextprotocol.io/) server that connects an AI assistant like Claude to
New York City's 311 data. Ask it how to report a problem, what your community district reports
most, how fast agencies close requests, or whether alternate side parking is on today. It
answers from the City's own data and tells you where each answer came from.

Built by [BetaNYC](https://beta.nyc). Free and open source.

**See every tool, with real questions and answers: [betanyc.github.io/nyc-311-mcp](https://betanyc.github.io/nyc-311-mcp/)**

> **If this is an emergency, or if you think this is an emergency, call 911.** Every answer
> from every tool ends with this text: "For informational purposes only. BetaNYC builds these
> answers from City data; they may contain errors. Check the City's 311 page before you
> report. If this is an emergency, or if you think this is an emergency, call 911."

## What's new in 1.3.0

Version 1.3.0 has **23** tools. Two are new, and every BetaNYC MCP server has them:
`whats_changed` tells you what changed in the server, and `about_betanyc` says who built it and
where to report a problem. Every change a reader would notice, including corrections, is listed
in [WHATS-CHANGED.md](WHATS-CHANGED.md) and on the
[website](https://betanyc.github.io/nyc-311-mcp/whats-changed.html).

## What was new in 1.2.0

Version 1.1.0 had 4 tools. Version 1.2.0 had **21**.

- **Help reporting a problem.** Describe it in your own words. It finds the City's 311 article
  for it, the agency, and every way to report it, and it can write a short report for you to
  paste in. It never files anything for you.
- **Your community district or Council district.** Eleven tools that answer from
  [BoardStat](https://www.beta.nyc/boardstat/), which BetaNYC builds every night from NYC Open
  Data: top problems, trends, how fast agencies close requests, what's still open, and every
  request at an address. Each answer links to the matching BoardStat page.
- **The Local Law 47 reports.** Rebuilds of the monthly 311 reports that
  [Local Law 47 of 2005](https://intro.nyc/0174-2004) (Gale A. Brewer) put in Charter § 1075.
  They are BetaNYC rebuilds, not the City's official reports.
- **Clearer answers from the original four.** Request status comes back in words, and the
  status alerts say yes or no.
- **A closing note on every answer**, the one quoted above.

It went through 19 beta builds before this release. The full history is in
[CHANGELOG.md](CHANGELOG.md).

## Install

You need [Node.js](https://nodejs.org/) 18 or later.

**Claude Desktop.** In the Claude menu, choose **Settings…** › **Developer** › **Edit Config**,
and add this inside `mcpServers` in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nyc-311": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-311-mcp"],
      "env": { "NYC_311_API_KEY": "your_key_here" }
    }
  }
}
```

Save, quit Claude Desktop completely, and open it again. No API key? Leave out the `"env"`
line and the comma before it.

**Claude Code.** In a terminal:

```bash
claude mcp add --env NYC_311_API_KEY=your_key_here --transport stdio nyc-311 \
  -- npx -y @betanyc/nyc-311-mcp
```

Add `--scope user` to use it in every project. Check it with `claude mcp get nyc-311`. No API
key? Leave out `--env NYC_311_API_KEY=your_key_here`.

**Any other MCP app.** Run `npx -y @betanyc/nyc-311-mcp`, with `NYC_311_API_KEY` set if you
have one.

To check it worked, ask your assistant "Which nyc-311 tools do you have?" You should see 23,
including `draft_311_report`. The [install guide](docs/install.md) has more detail.

**Already on 1.1.0?** `npx` keeps a copy of what it downloaded. If you still see 4 tools, quit
your app, delete the `_npx` folder in npm's cache (`~/.npm/_npx` on a Mac or Linux,
`%LOCALAPPDATA%\npm-cache\_npx` on Windows), and open the app again.

**Its data cache** is about 85 MB of public City data, in `~/Library/Caches/nyc-311-mcp` on a
Mac, `%LOCALAPPDATA%\nyc-311-mcp\Cache` on Windows, and `~/.cache/nyc-311-mcp` on Linux. Set
`NYC_311_MCP_CACHE_DIR` to put it somewhere else.

### Get a free API key

Seven tools use the [NYC 311 Public API](https://api-portal.nyc.gov/) and need a free key: the
calendar, status, the two request lookups, and the three reporting-help tools. The district
tools and the Local Law 47 reports work without one.

1. Go to [api-portal.nyc.gov](https://api-portal.nyc.gov/) and sign in or register.
2. Subscribe to **NYC 311 Public Developers**. It's self-serve.
3. Copy a key from your [profile page](https://api-portal.nyc.gov/profile). Each subscription
   has a primary and a secondary key. Either one works.

Keep the key to yourself. Never paste it into a GitHub issue.

The portal lists two other products. **NYC 311 Public — High Demand** gives a higher rate
limit. **NYC 311 Developer Partner** is for creating service requests, which this server never
does. You don't need either.

## Every tool

You don't need to know the tool names. Ask in plain English and your assistant picks the
tool. The [website](https://betanyc.github.io/nyc-311-mcp/tools.html) has the same list with a
replay of a real answer for each.

#### Help reporting a problem

Tell it what's wrong in your own words. It finds the City's own 311 article for that problem, the agency that handles it, and every way to report it. It can also write a short report for you to paste in. It never files anything. You do that yourself.

- **`how_to_report`** (New in 1.2.0; needs the free 311 API key). Describe the problem the way you'd tell a neighbor. It searches the City's 311 articles and gives back the best match: the article title and link on 311 Online, the agency, the 311 problem type, what the City says happens next, and every way to report it. Give it your district and it also tells you how often people there reported the same thing. If your description sounds dangerous, the first line tells you to call 911. It catches a lot, but it will miss some emergencies, so don't count on it for that.
  - Try asking:
    - “There's a pothole on my block that keeps getting bigger. How do I report it?”
    - “My upstairs neighbor plays loud music every night.”
    - “No heat in my apartment.”
    - “Overflowing trash can and a broken bench in the park.”
  - Inputs: `description` (required), `borough`, `community_district`, `council_district`, `last_days`, `category_id`, `limit`

- **`draft_311_report`** (New in 1.2.0; needs the free 311 API key). Writes a short report you can paste into 311 Online: the problem, where, when, and what you saw. It doesn't fill in anything you didn't tell it. If something is missing, it marks the gap and asks you. It links the right 311 page, lists the City's Problem Detail options (from a 2024 City list, so they may be out of date), and says what happens after you report. It won't write a draft when it sees danger. It tells you to call 911 instead. It doesn't send anything or fill in any form.
  - Try asking:
    - “Help me write a 311 report about a pothole at 7th Avenue and 9th Street in Brooklyn. It's been there since last week.”
    - “Draft a 311 report about a broken streetlight on my corner.”
  - Inputs: `description` (required), `location`, `borough`, `when`, `ongoing`, `details`, `include_contact`

- **`list_311_categories`** (New in 1.2.0; needs the free 311 API key). Browse 311's own topics, the same ones on 311 Online, when a match looks wrong or you just want to see what 311 covers. Pick a topic to list its articles, 20 at a time.
  - Try asking:
    - “What kinds of things can I report to 311?”
    - “Show me 311's noise articles.”
  - Inputs: `category_id`, `offset`


#### Your community district or Council district

These read the files [BoardStat](https://www.beta.nyc/boardstat/) builds every night from NYC Open Data, with 311 requests from 2020 on. Every answer links to the BoardStat page with the same district, dates and problems, so you can check the numbers yourself. No API key needed.

- **`find_district`** (New in 1.2.0; no key needed). Type an address the way you normally would. It tells you the community district and the Council district, and how many 311 requests have been made there since 2020.
  - Try asking:
    - “What community board and Council district is 250 Broadway in?”
  - Inputs: `address` (required), `borough`

- **`district_summary`** (New in 1.2.0; no key needed). The big picture for one district: how many requests, how many aren't closed, how long they take to close, and the top problems. For each top problem, it compares the district's share with the borough's and the city's.
  - Try asking:
    - “Give me a summary of 311 in Brooklyn Community Board 6.”
    - “What does 311 look like in Council District 7 this fiscal year?”
  - Inputs: `community_district`, `council_district`, `from_date`, `to_date`, `fiscal_year`, `last_days`, `limit`

- **`top_problems`** (New in 1.2.0; no key needed). The most-reported problems in a district for any period, next to the same days a year earlier.
  - Try asking:
    - “What were the top 311 complaints in Brooklyn 6 in the last 30 days?”
    - “Top problems in Council District 39 last fiscal year?”
  - Inputs: `community_district`, `council_district`, `from_date`, `to_date`, `fiscal_year`, `last_days`, `agency`, `status`, `limit`

- **`problem_trend`** (New in 1.2.0; no key needed). One problem, month by month, in one district, with the same days a year earlier next to each month.
  - Try asking:
    - “How has residential noise in Brooklyn 6 changed month to month this year?”
  - Inputs: `community_district`, `council_district`, `from_date`, `to_date`, `fiscal_year`, `last_days`, `problem` (required), `descriptions`, `exclude_descriptions`, `agency`, `status`

- **`agency_response`** (New in 1.2.0; no key needed). For each agency: how many requests, how many are closed, and the median and average days to close. Remember that closed doesn't mean fixed.
  - Try asking:
    - “How fast do agencies close requests in Council District 39?”
    - “Which agency is slowest in Bronx 1 this fiscal year?”
  - Inputs: `community_district`, `council_district`, `from_date`, `to_date`, `fiscal_year`, `last_days`, `problems`, `descriptions`, `exclude_descriptions`, `limit`

- **`still_open`** (New in 1.2.0; no key needed). Requests that aren't closed yet, oldest first, with how many days each has been open and a count by agency. The City doesn't define its statuses, so we explain each one and label the explanation as ours.
  - Try asking:
    - “What 311 requests in Brooklyn 6 are still open?”
    - “Which agency has the most open requests in Queens 1?”
  - Inputs: `community_district`, `council_district`, `from_date`, `to_date`, `fiscal_year`, `last_days`, `problems`, `descriptions`, `exclude_descriptions`, `agency`, `limit`

- **`top_addresses`** (New in 1.2.0; no key needed). The addresses with the most requests in a district, with each one's most common problem. You can narrow it to one problem.
  - Try asking:
    - “Which addresses in Brooklyn 6 get the most 311 requests?”
    - “Where are the most heat complaints in Bronx 5?”
  - Inputs: `community_district`, `council_district`, `from_date`, `to_date`, `fiscal_year`, `last_days`, `problems`, `descriptions`, `exclude_descriptions`, `agency`, `status`, `limit`

- **`address_history`** (New in 1.2.0; no key needed). Every request at one address since 2020, newest first, with the status explained and the agency's own resolution text. It's the closest thing to looking up a request when you don't have its number.
  - Try asking:
    - “What's been reported at 1 Centre Street?”
    - “Any open requests at City Hall?”
  - Inputs: `address` (required), `borough`, `community_district`, `from_date`, `to_date`, `fiscal_year`, `last_days`, `problems`, `status`, `limit`, `offset`, `data_as_of`

- **`find_requests`** (New in 1.2.0; no key needed). Every request in a district, newest first, a page at a time. Filter by problem, agency, or status, including the City's own statuses like Pending.
  - Try asking:
    - “Show me the newest street-condition requests in Brooklyn 6.”
    - “List DOT requests in Manhattan 3 that are Pending.”
  - Inputs: `community_district`, `council_district`, `from_date`, `to_date`, `fiscal_year`, `last_days`, `problems`, `descriptions`, `exclude_descriptions`, `agency`, `status`, `statuses`, `limit`, `offset`, `data_as_of`

- **`boardstat_link`** (New in 1.2.0; no key needed). Makes a BoardStat link with your district, dates, problem, agency, and status already set, so you can open the map and charts yourself.
  - Try asking:
    - “Give me a BoardStat link for residential noise in Brooklyn 6, last 90 days.”
  - Inputs: `community_district`, `council_district`, `from_date`, `to_date`, `fiscal_year`, `last_days`, `problems`, `descriptions`, `exclude_descriptions`, `agency`, `status`

- **`boardstat_status`** (New in 1.2.0; no key needed). How fresh BoardStat's data is, and whether last night's build ran late. Ask this when a number looks off.
  - Try asking:
    - “How fresh is BoardStat's data?”
  - Inputs: none


#### The Local Law 47 reports

In 2005, [Local Law 47](https://intro.nyc/0174-2004) (Gale A. Brewer) required monthly 311 reports from the City, written into Charter § 1075. Two of those reports were repealed in 2023. We rebuilt all three from NYC Open Data. They are BetaNYC rebuilds, not the City's official reports, and every answer says so. No API key needed.

- **`ll47_service_request_report`** (New in 1.2.0; no key needed). Rebuilds the monthly report on requests for service, formerly Charter § 1075(b): totals by category, agency, and status, and the average and median days to close, for a month and for the fiscal year to date. Citywide, by borough, or for one district.
  - Try asking:
    - “Rebuild the Local Law 47 monthly 311 report for Brooklyn 6.”
    - “Run the § 1075(b) report for Queens for October.”
  - Inputs: `month`, `fiscal_year`, `community_district`, `council_district`, `borough`, `by_district`, `read_every_district`, `limit`

- **`cb_monthly_list`** (New in 1.2.0; no key needed). The list that Charter § 1075(d), still law, says community boards should get: one district's requests for a month, every older request still unresolved, and the ones closed since. Comes in pages, or as a CSV.
  - Try asking:
    - “Give Brooklyn Community Board 6 its monthly list of 311 requests for October.”
    - “Same list for Staten Island 1, as a CSV.”
  - Inputs: `community_district` (required), `month`, `part`, `data_as_of`, `limit`, `offset`, `format`

- **`ll47_directory_assistance_report`** (New in 1.2.0; no key needed). Calls answered by 311 agents, by topic, for a month and the fiscal year to date, formerly Charter § 1075(c). This one is limited, and the answer says so: the open data can't separate out directory-assistance calls, and its agency column is blank. NYC Open Data can be slow here, so the first full-year answer may take a few tries.
  - Try asking:
    - “How many calls did 311 agents answer in October, by topic?”
  - Inputs: `month`, `fiscal_year`, `limit`


#### Today in the city

The City's own 311 calendar and status alerts. These were in 1.1.0, too.

- **`get_calendar`** (Same as 1.1.0; needs the free 311 API key). Alternate side parking, trash and recycling collection, and schools, for a day or up to 90 days.
  - Try asking:
    - “Is alternate side parking in effect today?”
    - “Is trash pickup on schedule the week of Thanksgiving?”
  - Inputs: `date`, `from_date`, `to_date`

- **`get_status`** (Improved in 1.2.0; needs the free 311 API key). Whether Code Blue, a fire hydrant emergency, snow or ice, or an emergency management alert is in effect right now. The answer now says it in words.
  - Try asking:
    - “Is there a Code Blue tonight?”
    - “Is there a snow emergency on the streets?”
  - Inputs: `type` (required)


#### Look up a 311 request

Have a 311 number, like 311-12345678? These tell you where it stands, in words. The City sends a status code, and we translate it.

- **`get_service_request`** (Improved in 1.2.0; needs the free 311 API key). Look up a request by its 311 number. You get the agency, the problem, the status in words, and the agency's own note about what it did. ZIP codes are removed.
  - Try asking:
    - “What happened with 311 request 311-17323508?”
  - Inputs: `sr_number` (required)

- **`get_service_request_list`** (Improved in 1.2.0; needs the free 311 API key). Several 311 numbers at once. Any number the City can't find is listed, so nothing quietly goes missing.
  - Try asking:
    - “Check these three 311 numbers for me: …”
  - Inputs: `sr_numbers` (required)


#### About this server

Ask what changed in the server lately, or who built it. Every BetaNYC MCP server has these two tools. They read the same list as the [What's changed](https://betanyc.github.io/nyc-311-mcp/whats-changed.html) page. No API key needed.

- **`whats_changed`** (New in 1.3.0; no key needed). What changed in this server, newest first: new tools, data fixes, and corrections when an answer was wrong. You can ask for corrections only, or for changes since a date.
  - Try asking:
    - “What's new in the 311 server?”
    - “Has the 311 server ever corrected a wrong answer?”
  - Inputs: `since`, `tag`, `limit`

- **`about_betanyc`** (New in 1.3.0; no key needed). Who built this server, where to report a problem or ask for a feature, and links to BetaNYC's events, newsletter, and ways to get involved.
  - Try asking:
    - “Who made this 311 tool?”
    - “Where do I report a bug in the 311 server?”
  - Inputs: none

## How the district tools read districts and dates

**Districts.** Give a community district or a Council district, not both.

- Community districts use BoardStat's numbers: the borough digit, then the district.
  Manhattan is 101 to 112, the Bronx 201 to 212, Brooklyn 301 to 318, Queens 401 to 414, and
  Staten Island 501 to 503. Board codes and names work too: `BK06`, `MN01`, "Brooklyn 6".
- Parks and other areas outside every community district have their own numbers (Joint
  Interest Areas): 164, 226, 227, 228, 355, 356, 480 to 484, and 595.
- Council districts are 1 to 51.

**Dates.** Give one of these:

- `from_date` and `to_date`, as YYYY-MM-DD. Data starts January 1, 2020.
- A City `fiscal_year`. It runs July 1 to June 30 and is named for the year it ends, so
  `2027` or `"FY27"` is July 1, 2026, to June 30, 2027.
- `last_days`. It counts back from the newest request in the data, not from today, because
  the City publishes 311 data a few days late.

With no dates, a tool uses the dates BoardStat's page opens with, about the last year.

Every district answer includes `data_as_of`, a `boardstat_url`, plain-language `caveats`, and
its `source`.

## Before you rely on an answer

- 311 counts are reports, not problems. They show who reports and how, and not only how many
  problems there are.
- "Closed" means an agency closed the request. It doesn't mean the problem was fixed. Read the
  agency's resolution text.
- The district numbers aren't official City statistics. Check them against the BoardStat page
  each answer links to.
- The City doesn't publish what its request statuses mean. Where we explain a status, the
  answer says the explanation is ours (`meaning_source: "BetaNYC"`).
- A request's 311 number (`311-XXXXXXXX`) and NYC Open Data's `unique_key` are different
  numbers, and nothing published links them. The district tools list `unique_key`, which
  `get_service_request` can't look up. Use `address_history` instead. Details:
  [docs/service-requests.md](docs/service-requests.md).
- Danger detection in `how_to_report` and `draft_311_report` looks for words and phrases. It
  will miss some emergencies. Every answer also tells the assistant to send the person to 911
  whenever anything suggests danger.
- We left ZIP codes out on purpose. ZIP codes are mail routes, not City districts.

## Tell us what you find

[Open an issue](https://github.com/BetaNYC/nyc-311-mcp/issues/new).
Tell us which tool, what you asked, what you got, and what you expected. GitHub issues are
public, so leave out names, phone numbers, home addresses, 311 request numbers, and your API
key. A street corner or a district is enough.

---

## Reference

### The original four tools, in detail

#### `get_calendar`

Alternate side parking, collections (trash, recycling, and compost), and schools, for one date
or a range of up to 90 days. With no dates, it gives today. Dates are New York time.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `date` | string | no | today | One date, YYYY-MM-DD |
| `from_date` | string | no | — | Range start, YYYY-MM-DD |
| `to_date` | string | no | — | Range end, YYYY-MM-DD |

A normal weekday:

```json
{
  "days": [
    {
      "today_id": "20261109",
      "items": [
        { "type": "Alternate Side Parking", "status": "IN EFFECT", "details": "Alternate side parking and meters are in effect." },
        { "type": "Collections", "status": "ON SCHEDULE", "details": "Trash, recycling, and compost collections are on schedule." },
        { "type": "Schools", "status": "OPEN", "details": "Public schools are open." }
      ]
    }
  ]
}
```

On a holiday, each item also has an `exceptionName`. A Memorial Day lookup returns
`"status": "SUSPENDED"` with `"exceptionName": "Memorial Day 2026"`.

#### `get_status`

Whether one City status is in effect right now. You get the API's own answer (`inEffect`, and
`eventName` for OEM) plus a `plain_language` block that says yes or no in words and when it was
asked. It isn't alternate side parking. Use `get_calendar` for that.

| `type` value | The City's description, from the 311 API portal (read 2026-11-08) |
|---|---|
| `CodeBlue` | "API to determine if Code Blue status is currently active" |
| `FireHydrant` | "API to determine if Fire Hydrant emergency is currently active" |
| `OEM` | "API to get OEM event currently active" |
| `SnowOnSidewalk` | "API to determine if Snow or Ice on Sidewalk emergency is currently active" |
| `SnowOnStreet` | "API to determine if Snow or Ice on Street emergency is currently active" |

#### `get_service_request`

One request by its 311 number (`sr_number`, as `311-XXXXXXXX`). You get the API's fields with
ZIP codes removed: agency, problem, problem details, status code, when it was submitted, the
address, and the agency's resolution text. Since 1.2.0, a `plain_language` block adds the
status in words (the API sends a code, `614110003` means Closed) and the address to give
`address_history`.

#### `get_service_request_list`

Several requests at once (`sr_numbers`, a list). Each comes back as in `get_service_request`.
The City leaves out a number it can't find without saying so, so since 1.2.0 they are listed
in `not_found`.

### Run it from source

```bash
git clone https://github.com/BetaNYC/nyc-311-mcp.git
cd nyc-311-mcp
npm install
npm run build
NYC_311_API_KEY=your_key npm start
```

Run the tests (they build first and need no API key or network):

```bash
npm test
```

### Data sources

- The four lookup tools and the three reporting-help tools use the
  [NYC 311 Public API](https://api-portal.nyc.gov/), run by the NYC Office of Technology and
  Innovation (OTI). The reporting help reads the same 311 articles you see on 311 Online.
- The eleven district tools, `ll47_service_request_report`, and `cb_monthly_list` read the
  files [BoardStat](https://www.beta.nyc/boardstat/) publishes every night from NYC Open
  Data's [311 Service Requests](https://data.cityofnewyork.us/d/erm2-nwe9) dataset. Only
  `www.beta.nyc` is contacted.
- `ll47_directory_assistance_report` reads NYC Open Data's 311 Call Center Inquiry dataset
  (`wewp-mm3p`), one month at a time, and saves what it reads. Set `SOCRATA_APP_TOKEN` if you
  have one. It works without one.
- `draft_311_report` reads NYC Open Data's
  [311 Service Level Agreements](https://data.cityofnewyork.us/d/cs9t-e3x8) for Problem Detail
  options. The City last updated that list on March 5, 2024.

Rate limits on the 311 API depend on your subscription, not on this server.

This is an independent, community-built project. It is not affiliated with, endorsed by, or
an official product of the City of New York.

### The website

The site at [betanyc.github.io/nyc-311-mcp](https://betanyc.github.io/nyc-311-mcp/) is built by
GitHub Pages from the `docs/` folder. `docs/index.html` and `docs/tools.html` are plain HTML.
Their demos are real answers, shortened, and every line shown is copied word for
word from the tool's answer. The Markdown pages in `docs/` share `docs/_layouts/default.html`.

`docs/whats-changed.html` is built from [WHATS-CHANGED.md](WHATS-CHANGED.md) by
`scripts/whats_changed.py`, a copy of BetaNYC's shared script (never edit the copy). After
changing `WHATS-CHANGED.md`, rebuild the page and commit it; CI fails while it is stale:

```bash
python3 scripts/whats_changed.py check WHATS-CHANGED.md
python3 scripts/whats_changed.py render WHATS-CHANGED.md --format jekyll --layout whats-changed \
  --out docs/whats-changed.html --repo-url https://github.com/BetaNYC/nyc-311-mcp
```

A release that adds or changes a tool also adds a `WHATS-CHANGED.md` entry tagged MCP, in the
same pull request as the version bump. `src/betanyc-tools.ts` (the `whats_changed` and
`about_betanyc` tools) is a copy too.

### Releases

Pushing a tag `vX.Y.Z` that matches the version in `package.json` runs
`.github/workflows/release.yml`. It runs the tests, publishes `@betanyc/nyc-311-mcp` to npm
with provenance, and creates a GitHub Release. Version history is in
[CHANGELOG.md](CHANGELOG.md). Publishing needs the `NPM_TOKEN` repository secret.

When the Release workflow succeeds, `.github/workflows/publish-mcp.yml` lists the new version
in the official [MCP Registry](https://registry.modelcontextprotocol.io/) as
`io.github.BetaNYC/nyc-311-mcp`, from `server.json`. Keep `server.json` at the same version
as `package.json`; the Release workflow checks.

---

## More from BetaNYC

### Related MCP servers

We maintain a set of free MCP servers for NYC and New York State civic data. The full
directory, with install steps for each, is at **[beta.nyc/ai-tools](https://beta.nyc/ai-tools)**.

- **[nyc-council-mcp](https://github.com/BetaNYC/nyc-council-mcp)**: City Council legislation, hearings, votes, and members
- **[nyc-checkbook-mcp](https://github.com/BetaNYC/nyc-checkbook-mcp)**: City spending, contracts, budget, payroll, and revenue
- **[nyc-record-mcp](https://github.com/BetaNYC/nyc-record-mcp)**: City Record notices, including procurement, awards, and public hearings
- **[nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules)**: the NYC Charter, Administrative Code, and Rules of the City of New York
- **[nys-openlegislation-mcp](https://github.com/BetaNYC/nys-openlegislation-mcp)**: New York State bills, laws, members, and committees

For questions across all of NYC Open Data, including the full 311 dataset, try
[socrata-mcp-server](https://github.com/npstorey/socrata-mcp-server), a third-party MCP by
[Nathan Storey](https://github.com/npstorey).

### About BetaNYC

[BetaNYC](https://beta.nyc) is New York's civic technology and open data community. We work
to improve lives in New York through civic design, technology, and data.

Come do civic tech with us. We run [NYC School of Data](https://www.schoolofdata.nyc/),
[CityCamp NYC](https://citycamp.nyc), and events all year. See what's coming up on our
[events calendar](https://www.beta.nyc/events/).

### Building on this? Tell us!

If you build something with this, we'd love to hear about it, and we can help other New Yorkers
find it. [Subscribe to our weekly newsletter](https://beta.nyc/newsletter), or
[send us a link](https://www.beta.nyc/newsletter-inbox/) for an upcoming issue.

### Contributing

Issues and pull requests are welcome at
[github.com/BetaNYC/nyc-311-mcp](https://github.com/BetaNYC/nyc-311-mcp). Other BetaNYC MCPs in
testing are listed on [Beta MCPs](https://betanyc.github.io/nyc-311-mcp/beta/).

### Support our work

These servers are free. Freedom isn't free. [Become a Beta Builder](https://beta.nyc/donate/).

---

## License

MIT License

Copyright (c) 2026 BetaNYC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
