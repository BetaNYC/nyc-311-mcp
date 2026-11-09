---
title: Beta MCPs
---

# Beta MCPs

BetaNYC builds free, open-source [MCP servers](https://modelcontextprotocol.io/) that
let AI assistants such as Claude work with NYC and New York State civic data. Before a
big change is released, we ask staff and community members to try it. This page lists
what is in testing right now.

## What a beta is

- **It is unreleased.** A beta runs straight from a work-in-progress branch on GitHub.
  It is not on npm, and anyone using the released version keeps the released version.
  Nothing changes for them.
- **It may change, or break, without notice.** Tools can be renamed, answers can change
  shape, and a fix can land between one day and the next.
- **Its answers still need checking.** Compare anything important with the source the
  answer links to.
- **You can switch back at any time.** Each beta page shows how.

## In testing now

| MCP | What is new | Guide |
|---|---|---|
| `@betanyc/nyc-311-mcp` (next version, beta) | 17 new tools: district numbers from BoardStat, rebuilt Local Law 47 of 2005 reports, request lookup by address, and help reporting a problem to 311 | [Test the nyc-311-mcp beta](nyc-311-mcp.md) |

## How to give feedback

Open a [beta feedback issue](https://github.com/BetaNYC/nyc-311-mcp/issues/new?template=beta-feedback.yml)
on the MCP's GitHub repository. Tell us which tool, what you asked, what you got, and
what you expected. GitHub issues are public, so leave out names, phone numbers, email
addresses, home addresses, and anything else about a real person.

## Adding a beta to this page (for maintainers)

1. Put the work on a branch and confirm it installs with
   `npx -y github:BetaNYC/<repo>#<branch>` and answers an MCP `tools/list`.
2. Add a row to the table above and a page next to this one, `docs/beta/<repo>.md`,
   following the nyc-311-mcp page: what is new, install, what to test, safety notes if
   any, feedback, switching back.
3. Add a `beta-feedback.yml` issue form to that repository's `.github/ISSUE_TEMPLATE/`.
4. When the beta is released, move its row to a "Released" note and point the page at
   the npm package.
