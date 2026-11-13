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

Version 1.3.0 has **24** tools. Three are new: `whats_changed` tells you what changed in the
server, `about_betanyc` says who built it and where to report a bug in this server or ask for a new feature,
and `about_data` says where each answer's data comes from, whether it is official, how current it is, and
where to check it. Every BetaNYC MCP server is getting these three tools; nyc-311-mcp is the first. The
data sources are listed in [DATA-SOURCES.json](DATA-SOURCES.json) and published as a
[DCAT-US 3.0 catalog](data.json). Every change a reader would notice, including corrections, is listed
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

To check it worked, ask your assistant "Which nyc-311 tools do you have?" You should see 24
(21 on version 1.2.0), including `draft_311_report`. The [install guide](docs/install.md) has more detail.

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

{BETA_TOOLS}

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

[DATA-SOURCES.json](DATA-SOURCES.json) lists every source, source by source: who publishes it,
what BetaNYC changed, what it covers, its terms and credit line, where to check a number and
where to report an error. The `about_data` tool answers from it, and says how current each
source is on your computer from what the server last downloaded. A test fails if a tool is
not listed under a source. `data.json`, a [DCAT-US 3.0](https://resources.data.gov/resources/dcat-us3/)
catalog, is made from the same file, at the repo root (it ships in the npm package). A copy on
the website ([docs/data.json](https://betanyc.github.io/nyc-311-mcp/data.json)) is made the same
way, and CI fails unless the two match. There is no `croissant.json`, because this repo publishes no
data files of its own; BoardStat publishes the district files. After changing `DATA-SOURCES.json`:

```bash
python3 scripts/whats_changed.py about-data check DATA-SOURCES.json
python3 scripts/whats_changed.py about-data catalog DATA-SOURCES.json
python3 scripts/whats_changed.py about-data catalog DATA-SOURCES.json --dcat docs/data.json
```

CI fails while `data.json` is stale, and validates it against the DCAT-US 3.0 schema
(`scripts/tests/catalog_validate.py` and `scripts/mcp_shared/`, copies of BetaNYC's shared
files). Questions about the data go to BetaNYC at lab@beta.nyc, the contact address in
`DATA-SOURCES.json` and `data.json`.

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
same pull request as the version bump, headed `## Unreleased: Title`. The release commit
changes that heading to `## YYYY-MM-DD: Title` (the release date in New York, same title), and
the tag goes on that commit; the Release workflow refuses to publish while an Unreleased entry
is left. `src/betanyc-tools.ts` (the `whats_changed`,
`about_betanyc` and `about_data` tools) is a copy too.

### Releases

Pushing a tag `vX.Y.Z` that matches the version in `package.json` runs
`.github/workflows/release.yml`. It runs the tests, publishes `@betanyc/nyc-311-mcp` to npm
with provenance, and creates a GitHub Release. Version history is in
[CHANGELOG.md](CHANGELOG.md). Publishing needs the `NPM_TOKEN` repository secret.

**Release day.** A version bump merges with its `WHATS-CHANGED.md` entry headed
`## Unreleased: Title` and its `CHANGELOG.md` heading undated (`## [X.Y.Z] - Unreleased`), the
entry's MCP version linking to `CHANGELOG.md` with no anchor. On the day the tag goes on, make
one commit that:

1. changes `## Unreleased: Title` to `## YYYY-MM-DD: Title` (same title, today's date in New
   York; `check` rejects a future date);
2. gives the `CHANGELOG.md` heading the same date (`## [X.Y.Z] - YYYY-MM-DD`);
3. adds the dated anchor to the MCP version link, computed with the script, never by hand:
   `python3 -c "import sys; sys.path.insert(0,'scripts'); import whats_changed as w; print(w.github_slug('[X.Y.Z] - YYYY-MM-DD'))"`;
4. rebuilds `docs/whats-changed.html` (the command under "The website") and runs
   `python3 scripts/whats_changed.py check WHATS-CHANGED.md --release`.

The title stays exactly the same: only `Unreleased` becomes the date. That commit may reword
the entry's other lines; until it has a date, an Unreleased entry's body counts as
unpublished, so the append-only check needs no `Whats-changed-edit:` trailer for it.

Then tag that commit `vX.Y.Z` and push the tag. The Release workflow runs the same
`check --release` before `npm publish` and stops while an Unreleased entry is left. It also
runs `python3 scripts/whats_changed.py about-data check DATA-SOURCES.json --release`, which
stops a release while the contact address in `DATA-SOURCES.json` is a placeholder.

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

{LICENSE_BODY}
