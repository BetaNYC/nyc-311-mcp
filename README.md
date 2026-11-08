# nyc-311-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for the [NYC 311 Public API](https://api-portal.nyc.gov/) — the city-services calendar, emergency and weather status alerts, and 311 service-request lookup.

NYC 311 is the city's central hub for non-emergency city services. This server exposes the public 311 API so an AI assistant can answer questions like whether alternate-side parking is suspended today, whether a Code Blue cold-weather alert is in effect, or what the status of a filed service request is.

Vibe coded with [Claude](https://claude.ai) by [BetaNYC](https://beta.nyc).

---

## What it does

Exposes 20 tools over MCP. Seven use the NYC 311 Public API (they need an API key):

| Tool | Description |
|---|---|
| `get_calendar` | Alternate Side Parking, Collections (trash/recycling/compost), and Schools status for a date or range (max 90 days) |
| `get_status` | Current city status for an emergency or weather condition (Code Blue, fire hydrants, OEM alerts, snow) |
| `get_service_request` | Look up one 311 service request by its 311 number, with BetaNYC's plain-language reading of its status (the City publishes no definitions) and the agency's resolution text; for other requests at its address, use `address_history` |
| `get_service_request_list` | Look up several at once; numbers the API did not find are listed in `not_found` |
| `how_to_report` | From a plain description ("a pothole on my block"), the 311 article that fits (title, KA number, link on 311 Online), the agency and 311 problem type it names, what it says to do, and the ways to report, all from the City's own 311 content; one match per problem when a description names several. Every answer and every error starts with "If anyone is in danger right now, call 911."; a description that suggests danger, and every no-match answer, leads with 911, in the City's words only when the City article is that danger. **Danger detection is keyword-based; it will miss some emergencies**, so every answer also tells the calling assistant to send the person to 911 whenever anything suggests danger. Matching is BetaNYC's, by keyword (some Spanish, simple typos). **Files nothing.** Details: [docs/how-to-report.md](docs/how-to-report.md) |
| `list_311_categories` | 311's own topic categories, or the articles in one, to browse when a match looks wrong |
| `draft_311_report` | A short ready-to-paste 311 report for the person to submit themselves (problem, where, when, what they saw), the 311 Online article link to report it on, questions for anything missing (marked `[add: …]`, never made up), Problem Detail options from the City's 2024 Service Level Agreements list (labeled old), what the article says about contact details and photos, and what happens next. Uses `how_to_report`'s matching and danger check; never drafts when danger is flagged (call 911); safety line first on every answer and error; one draft per problem. **Files nothing, sends nothing, fills no form.** The City does not publish each form's fields, so the form may ask for more. Details: [docs/draft-a-report.md](docs/draft-a-report.md) |

Eleven answer district questions from the files [BoardStat](https://www.beta.nyc/boardstat/)
publishes every night (no key needed; only `www.beta.nyc` is contacted). Their numbers match
the BoardStat page each answer links to. Details: [docs/district-tools.md](docs/district-tools.md).

| Tool | Answers |
|---|---|
| `find_district` | Which community district and Council district an address is in (typed as you would, converted to the City's spelling) |
| `district_summary` | Totals and top problems for a district and period, with each problem's share compared with the borough and city |
| `top_problems` | The most-reported problems for a district and period, with the same days a year earlier |
| `problem_trend` | Requests per month for one problem in one district, with the same days a year earlier |
| `agency_response` | Requests, closed, not yet closed, and median and average days to close, by agency |
| `still_open` | Requests not yet closed, oldest first, with days open and a count per agency |
| `top_addresses` | Addresses with the most requests, optionally for given problems or descriptions |
| `address_history` | Every request at one address, with status (explained) and the agency's resolution text; pages with `offset` |
| `find_requests` | Every request in a district, any status, newest first, paged; filters for problem, description, agency, `status` or the City's own `statuses` (such as `Pending`), each status explained |
| `boardstat_link` | A BoardStat link with the given district, dates, problems, agency and status set |
| `boardstat_status` | How fresh BoardStat's data is, and whether its nightly run is late |

Every district tool takes a community district (BoardStat's ids: `101` is Manhattan
Community District 1, `306` Brooklyn 6) or a Council district (`1` to `51`), and dates as
`from_date`/`to_date`, a City `fiscal_year` (July 1 to June 30; `2027` or `"FY27"`), or
`last_days`. Every answer carries `data_as_of`, a `boardstat_url`, plain-language `caveats`
and its `source`. They are built by BetaNYC from NYC Open Data and are **not an official City report**.
311 counts are reports, not problems, and "closed" does not mean fixed. No ZIP codes.

Three rebuild the monthly 311 reports that [Local Law 47 of 2005](https://intro.nyc/0174-2004)
(Gale A. Brewer) put in Charter § 1075. Each answer says which section it rebuilds, whether
that section is still law ([Local Law 69 of 2023](https://intro.nyc/1004-2023) repealed (b)
and (c)), and that it is **a BetaNYC rebuild from NYC Open Data, not the City's official
report**. Details, and a comparison with the City's own 311 Reporting dashboards:
[docs/local-law-47-reports.md](docs/local-law-47-reports.md).

| Tool | Rebuilds | Reads |
|---|---|---|
| `ll47_service_request_report` | Former § 1075(b): for a month and the fiscal year to date, totals by category and agency, by status, and average (and median) days to close per category per agency. Citywide, a borough, a community or Council district, or a table of every district | BoardStat |
| `ll47_directory_assistance_report` | Former § 1075(c): calls to 311 agents by topic, month and fiscal year to date. **Limited**: the open data cannot pick out directory-assistance calls, and its agency column is blank | NYC Open Data `wewp-mm3p`, one query per month, cached |
| `cb_monthly_list` | § 1075(d), current law: one community district's requests for a month, every older one still unresolved, and those unresolved at the month's end and closed since, with category, agency and status; pages tied to one build, or CSV | BoardStat |

---

## Tools reference

### `get_calendar`

Returns Alternate Side Parking, Collections (trash/recycling/compost), and Schools status for a single date or a date range. The range may not exceed 90 days. If no parameters are given, it defaults to today. Dates are interpreted in the America/New_York timezone — "today" means today in New York, regardless of the server's local time.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `date` | string | no | today | Single date, YYYY-MM-DD — used for both ends if no range given |
| `from_date` | string | no | — | Range start, YYYY-MM-DD |
| `to_date` | string | no | — | Range end, YYYY-MM-DD |

```
get_calendar()                                       → today
get_calendar(date="2026-07-04")
get_calendar(from_date="2026-07-01", to_date="2026-07-07")
```

Sample response (a normal weekday):

```json
{
  "days": [
    {
      "today_id": "20260622",
      "items": [
        { "type": "Alternate Side Parking", "status": "IN EFFECT", "details": "Alternate side parking and meters are in effect." },
        { "type": "Collections", "status": "ON SCHEDULE", "details": "Trash, recycling, and compost collections are on schedule." },
        { "type": "Schools", "status": "OPEN", "details": "Public schools are open." }
      ]
    }
  ]
}
```

The three `type` values are `Alternate Side Parking`, `Collections` (trash, recycling, and compost), and `Schools`. On holidays each item also carries an `exceptionName` — for example, a Memorial Day lookup returns `"status": "SUSPENDED"` with `"exceptionName": "Memorial Day 2026"`.

---

### `get_status`

Returns the current city status for one emergency or weather condition.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `type` | string | yes | — | One of: `CodeBlue`, `FireHydrant`, `OEM`, `SnowOnSidewalk`, `SnowOnStreet` |

| `type` value | What it reports |
|---|---|
| `CodeBlue` | Extreme-cold-weather shelter alert (Code Blue) |
| `FireHydrant` | Fire-hydrant clearing status |
| `OEM` | Office of Emergency Management active alerts |
| `SnowOnSidewalk` | Snow-on-sidewalk clearing status |
| `SnowOnStreet` | Snow-on-street clearing status |

```
get_status(type="CodeBlue")
get_status(type="SnowOnStreet")
```

---

### `get_service_request`

Look up one 311 service request by its 311 number. Returns the API's fields (agency, problem, problem details, status code, submitted time, address, the agency's resolution text) with ZIP codes removed, plus a `plain_language` block: the status in words (the API sends a code, `614110003` = Closed), what it means, the resolution, and the address to pass to `address_history` for other requests there.

The 311 number is **not** NYC Open Data's `unique_key` (two matched requests, 2026-11-07), Open Data does not publish the 311 number, and we found no published source that links them, so a looked-up request is not matched to its BoardStat row by number. Use `address_history` with `plain_language.address_lookup` for its address. Status meanings are BetaNYC's reading (`meaning_source: "BetaNYC"`), not City definitions. Evidence: [docs/service-requests.md](docs/service-requests.md).

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `sr_number` | string | yes | — | Service request number, format `311-XXXXXXXX` |

```
get_service_request(sr_number="311-17323508")
```

---

### `get_service_request_list`

Look up several service requests in a single call. Each comes back as in `get_service_request`. The API leaves out a number it cannot find, without an error; `not_found` lists them.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `sr_numbers` | string[] | yes | — | Array of service request numbers |

```
get_service_request_list(sr_numbers=["311-17323508", "311-17323514"])
```

---

## Common workflows

### Check today's city services before heading out

```
get_calendar()                       → is alternate-side parking suspended? are schools open?
get_status(type="SnowOnStreet")      → is street snow-clearing under way?
```

### Watch for a cold-weather emergency

```
get_status(type="CodeBlue")          → is an extreme-cold shelter alert in effect?
get_status(type="OEM")               → any other active OEM alerts?
```

### Plan around a holiday week

```
get_calendar(from_date="2026-07-01", to_date="2026-07-07")   → ASP / collection / schools across the week
```

### Track filed complaints

```
get_service_request(sr_number="311-17323508")                          → one request's current status
get_service_request_list(sr_numbers=["311-17323508", "311-17323514"])  → several at once
```

### Find out how to report a problem

```
how_to_report(description="no heat in my apartment")                   → KA-01036, HPD, "Heat/Hot Water", how to report
how_to_report(description="a pothole on my block", community_district=306)  → plus how often it was reported in Brooklyn CD 6
list_311_categories(category_id="311-12")                               → every Noise article, to pick another
draft_311_report(description="a pothole on my block", location="Broadway and W 96 St", borough="Manhattan")
                                                                        → paste-ready text, the KA-01093 link, what to add
```

---

## Prerequisites

- Node.js 18 or later
- An NYC 311 Public API subscription key (free), for the seven tools that use the 311 API only (the four lookups and the three reporting-help tools). The district tools and the Local Law 47 reports need no key.
- Optional: a Socrata app token as `SOCRATA_APP_TOKEN`, sent as `X-App-Token` by `ll47_directory_assistance_report` (the only tool that queries NYC Open Data). It works without one.

---

## API key

**For the seven 311 API tools (the four lookup tools, `how_to_report`, `list_311_categories` and `draft_311_report`), yes — a free API key is required.** The eleven district tools read BoardStat's public files and need no key. The NYC 311 Public API requires a subscription key on every request. Get one (free) from the NYC API portal and set it as the `NYC_311_API_KEY` environment variable:

1. Go to [api-portal.nyc.gov](https://api-portal.nyc.gov/) and register / sign in.
2. Subscribe to the **NYC 311 Public Developers** product (see the table below for which product to choose).
3. On your [profile page](https://api-portal.nyc.gov/profile), copy a subscription key. Each subscription has a **primary** and a **secondary** key — either one works; the pair exists so you can rotate keys without downtime.
4. Set it as the `NYC_311_API_KEY` environment variable, e.g. `export NYC_311_API_KEY="your-subscription-key"`.

### Which product to subscribe to

The portal lists three NYC 311 products. This server's tools (calendar, status, and service-request **lookup**) only need the public read API:

| Product | Use it if… | Approval |
|---|---|---|
| **NYC 311 Public Developers** | ✅ Recommended for this server. General-public access to the read API, with a standard rate limit. | Self-serve |
| **NYC 311 Public — High Demand** | You need a higher rate limit than the standard tier provides. | Admin approval in some cases |
| **NYC 311 Developer Partner** | You need to **create** service requests (this server does not — it only reads). | Admin approval required |

The key is sent as the `Ocp-Apim-Subscription-Key` header on every request. The server reads it lazily — it only fails when you actually call a tool without a key set, never at startup.

---

## Installation

### Option 1 — npx (no install required)

```bash
NYC_311_API_KEY=your_key npx @betanyc/nyc-311-mcp
```

### Option 2 — global install

```bash
npm install -g @betanyc/nyc-311-mcp
NYC_311_API_KEY=your_key nyc-311-mcp
```

### Option 3 — build from source

```bash
git clone https://github.com/BetaNYC/nyc-311-mcp.git
cd nyc-311-mcp
npm install
npm run build
NYC_311_API_KEY=your_key npm start
```

Run the test suite (builds first; no API key or network needed):

```bash
npm test
```

---

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nyc-311": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-311-mcp"],
      "env": {
        "NYC_311_API_KEY": "your_key_here"
      }
    }
  }
}
```

### Claude Code

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "nyc-311": {
      "command": "npx",
      "args": ["-y", "@betanyc/nyc-311-mcp"],
      "env": {
        "NYC_311_API_KEY": "your_key_here"
      }
    }
  }
}
```

---

## Example usage

Once connected, you can ask your AI assistant things like:

- *"Is alternate-side parking suspended today?"*
- *"Are schools open on July 4th?"*
- *"Is there a Code Blue in effect right now?"*
- *"What's the status of service request 311-17323508?"*
- *"Look up these three 311 complaints for me."*

---

## Notes & limitations

- **`get_service_request` looks up by number only.** The 311 API resolves a known SR number (`311-XXXXXXXX`); it does not search by address, agency, or area. For questions by district, address, agency or problem, use the district tools above (`top_problems`, `address_history`, `agency_response` and the rest), which read files built nightly from NYC Open Data by BoardStat, from the [311 Service Requests dataset](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9).
- **Calendar range cap.** `get_calendar` accepts a span of up to 90 days; longer ranges are rejected before the request is sent.
- **Response shapes.** `get_calendar` returns the documented `days` / `items` structure. `get_status` is the API's raw JSON. The service-request tools return the API's fields unchanged except that ZIP codes are removed, plus the added `plain_language` block (and `not_found` for the list).
- **Two numbers for one request.** The 311 number (`311-XXXXXXXX`) and Open Data's `unique_key` are different numbers (two matched requests, 2026-11-07). District tools list `unique_key`; it cannot be looked up with `get_service_request`. See [docs/service-requests.md](docs/service-requests.md).
- **Rate limits** are governed by your subscription tier on the NYC API portal, not by this server.

## Roadmap

More district work is planned under epic
[#12](https://github.com/BetaNYC/nyc-311-mcp/issues/12): the monthly reports that
[Local Law 47 of 2005](https://intro.nyc/0174-2004) (Int 0174-2004) asked for (#15), request lookup by address and district (#16), and help reporting a
problem to 311 (#17, #18). None of those are released yet. The draft (#18) still needs testing
with real people on real problems. The server will not file requests on anyone's behalf.

---

## Data source

The four lookup tools and the three reporting-help tools (`how_to_report`, `list_311_categories`, `draft_311_report`, through the API's content operations GetCategory, GetContentList and GetContent) use the [NYC 311 Public API](https://api-portal.nyc.gov/), operated by the NYC Office of Technology and Innovation (OTI); access requires a free subscription key. The eleven district tools read the files [BoardStat](https://www.beta.nyc/boardstat/) publishes nightly from NYC Open Data. `draft_311_report` also reads NYC Open Data's [311 Service Level Agreements](https://data.cityofnewyork.us/d/cs9t-e3x8) (`cs9t-e3x8`, no key; last updated by the City 2024-03-05) for Problem Detail options, kept 30 days.

This is an independent, community-built project from BetaNYC. It is not affiliated with, endorsed by, or an official product of the City of New York.

---

## Related projects

Part of BetaNYC's family of MCP servers for NYC and NYS civic data:

- **[nyc-record-mcp](https://github.com/BetaNYC/nyc-record-mcp)** — City Record notices: procurement, awards, public hearings
- **[nyc-checkbook-mcp](https://github.com/BetaNYC/nyc-checkbook-mcp)** — City spending, contracts, budget, payroll, and revenue
- **[nyc-council-mcp](https://github.com/BetaNYC/nyc-council-mcp)** — City Council legislation, hearings, votes, and members
- **[nyc-charter-laws-rules](https://github.com/BetaNYC/nyc-charter-laws-rules)** — NYC Charter, Administrative Code, and Rules of the City of New York
- **[nys-openlegislation-mcp](https://github.com/BetaNYC/nys-openlegislation-mcp)** — New York State bills, laws, members, and committees

## About BetaNYC

This project is built and maintained by [BetaNYC](https://beta.nyc), New York's
civic technology and open-data community. We work to improve lives in New York
through civic design, technology, data, and public-interest technology.

**Come do civic tech with us.** We run public events, meetups, and hands-on
data classes throughout the year — including [NYC School of Data](https://www.schoolofdata.nyc/)
and [CityCamp NYC](https://citycamp.nyc), and we host frequent civic-tech gatherings. See what's coming up on our
[events calendar](https://www.beta.nyc/events/).

**Sustain this work.** These MCP servers are free and open source. To help keep this work going and find BetaNYC's
tools, please consider [donating and becoming a Beta
Builder](https://beta.nyc/donate).

## Building on this? Tell us!

If you build something with this project, we'd love to hear about it. We can help other New Yorkers find it. BetaNYC publishes a weekly newsletter,
*This Week in NYC's Civic Technology and Open Data*.

- **[Subscribe to the newsletter](https://beta.nyc/newsletter)** to keep up with
  NYC civic tech, open data, and public-interest technology.
- **Built something, or found a story worth sharing?** [Submit a link for the
  newsletter](https://www.beta.nyc/newsletter-inbox/) and we'll consider it for
  an upcoming issue.

## Related BetaNYC MCP servers

BetaNYC maintains a suite of open-source MCP servers for NYC and NYS civic data.
See the full directory, with install details for each, at
**[beta.nyc/ai-tools](https://beta.nyc/ai-tools)**.

> **Working with the wider NYC Open Data portal?** For citywide complaint analysis
> beyond single service-request lookup, the 311 Service Requests dataset lives on
> NYC Open Data. Query it, and the rest of the catalog, with
> [socrata-mcp-server](https://github.com/npstorey/socrata-mcp-server)
> (`socrata-mcp-server` on npm), a third-party MCP by [Nathan Storey](https://github.com/npstorey).

---

## Contributing

Issues and pull requests welcome at [github.com/BetaNYC/nyc-311-mcp](https://github.com/BetaNYC/nyc-311-mcp).

## Releases

Releases are automated. Pushing a tag `vX.Y.Z` that matches the version in
`package.json` triggers `.github/workflows/release.yml`, which runs the tests,
publishes `@betanyc/nyc-311-mcp` to npm (with provenance), and creates a
GitHub Release with generated notes. Version history lives in
[CHANGELOG.md](CHANGELOG.md). Publishing requires the `NPM_TOKEN` repository
secret.

---

## Support our work

Freedom isn't free. [Support BetaNYC](https://beta.nyc/donate/).

## License

MIT License

Copyright (c) 2026 BetaNYC

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
