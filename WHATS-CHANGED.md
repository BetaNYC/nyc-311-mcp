# What's changed

This page lists the changes to nyc-311-mcp that a reader would notice: new tools, new data, changes to the website, and corrections when the server gave a wrong answer. Newest first. Routine data refreshes are not listed.

- **History begins:** 2026-06-21, the first release. Corrections made before this date may be missing.
- **Data refresh:** The district tools read files that BoardStat rebuilds every night from NYC Open Data. The calendar, status alerts and request lookups ask the City's 311 Public API each time.

To report a bug in this server or ask for a new feature, [open an issue on GitHub](https://github.com/BetaNYC/nyc-311-mcp/issues).

## 2026-11-13: A What's changed page, and three tools that explain the server

- **Tags:** Site, MCP
- **What changed:** The website has a new page that lists every change a reader would notice. Three new tools let your AI assistant answer "what's new in this server?", "who built this?" and "where does this data come from?", with links to BetaNYC and to the place to report a bug in this server or ask for a new feature. The third names each source and its publisher, says whether the numbers are an official record or BetaNYC's own, how current the data is, and where to check a number with the City. The same list of sources is published as a data catalog.
- **MCP version:** [nyc-311-mcp 1.3.0](CHANGELOG.md#130---2026-11-13)
- **More detail:** [What's changed on the website](https://betanyc.github.io/nyc-311-mcp/whats-changed.html) · [Where the data comes from](DATA-SOURCES.json) · [Data catalog](data.json) · [Release notes](CHANGELOG.md)

## 2026-11-09: Version 1.2.0 adds 17 tools, from reporting help to district numbers

- **Tags:** MCP, Data
- **What changed:** The server went from 4 tools to 21. New tools find the right way to report a problem to 311 and draft a report you file yourself, give 311 numbers for a community district or Council district from BoardStat, and rebuild the three monthly 311 reports that Local Law 47 of 2005 required. Every answer now ends with a reminder to call 911 in an emergency.
- **MCP version:** [nyc-311-mcp 1.2.0](CHANGELOG.md#120---2026-11-09)
- **More detail:** [Every tool, with real questions and answers](https://betanyc.github.io/nyc-311-mcp/tools.html) · [Release notes](CHANGELOG.md#120---2026-11-09) · [The release on GitHub](https://github.com/BetaNYC/nyc-311-mcp/releases/tag/v1.2.0)

## 2026-11-09: A website for the server, with a page for every tool

- **Tags:** Site
- **What changed:** The website went live with a home page, an install guide, and a page that shows what each tool does, with a real question and answer for most of them.
- **More detail:** [The website](https://betanyc.github.io/nyc-311-mcp/) · [Pull request](https://github.com/BetaNYC/nyc-311-mcp/pull/29)

## 2026-07-21: Tools ignored settings they did not have, without saying so

- **Tags:** MCP, Correction
- **What changed:** From June 21 to July 21, 2026, when an AI assistant passed a setting a tool does not have, the tool dropped it without saying so. The answer looked right but could answer a different question. Version 1.1.0 refuses the call and names the settings the tool does accept.
- **If you used the old numbers:** We know of no wrong answer this caused in nyc-311-mcp. If you asked a question then that named something the tool could not filter on, ask it again with the current version.
- **MCP version:** [nyc-311-mcp 1.1.0](CHANGELOG.md#110--2026-07-21)
- **More detail:** [The issue](https://github.com/BetaNYC/nyc-311-mcp/issues/7) · [The fix](https://github.com/BetaNYC/nyc-311-mcp/pull/8)

## 2026-07-06: Asking for today's calendar in the evening gave the next day's

- **Tags:** MCP, Correction
- **What changed:** From June 21 to July 6, 2026, asking for the 311 calendar (alternate side parking, trash collection and schools) without a date after about 8 p.m. New York time returned the next day's calendar. Version 1.0.1 uses the date in New York. It also explains errors from the City's 311 API more clearly.
- **If you used the old numbers:** If you asked for today's calendar on an evening in that period without giving a date, the answer was for the next day. Answers that named a date were not affected.
- **MCP version:** [nyc-311-mcp 1.0.1](CHANGELOG.md#101--2026-07-06)
- **More detail:** [The fix](https://github.com/BetaNYC/nyc-311-mcp/pull/4)

## 2026-06-21: First release, with the 311 calendar, status alerts and request lookup

- **Tags:** MCP
- **What changed:** The first version, published on npm, had four tools: the City's 311 calendar for alternate side parking, collections and schools; emergency and weather status alerts; and lookup of one or several 311 requests by number. It reached npm on the evening of June 21 in New York; CHANGELOG.md lists it as 2026-06-22, the date in UTC.
- **MCP version:** [nyc-311-mcp 1.0.0](CHANGELOG.md#100--2026-06-22)
- **More detail:** [Release notes](CHANGELOG.md#100--2026-06-22) · [The package on npm](https://www.npmjs.com/package/@betanyc/nyc-311-mcp)
