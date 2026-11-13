---
title: Install nyc-311-mcp
---

# Install nyc-311-mcp

nyc-311-mcp connects an AI assistant to New York City's 311 data. Version 1.3.0 has 23
tools. This page covers Claude Desktop and Claude Code. Any app that runs MCP servers works
the same way: it runs `npx -y @betanyc/nyc-311-mcp`.

**If this is an emergency, or if you think this is an emergency, call 911.** Don't rely on
an AI assistant to notice danger.

## Before you start

You need:

- **Node.js 18 or later.** Check with `node --version` in a terminal. Get it from
  [nodejs.org](https://nodejs.org/) (the LTS version) if it's missing or older.
- **An AI app that supports MCP**, such as Claude Desktop or Claude Code.
- **Optional: a free NYC 311 API key.** Seven tools need it: the calendar, status, the two
  request lookups, and the three reporting-help tools. The district tools and the Local Law
  47 reports work without one. To get a key, sign in at
  [api-portal.nyc.gov](https://api-portal.nyc.gov/), subscribe to **NYC 311 Public
  Developers**, and copy a key from your [profile page](https://api-portal.nyc.gov/profile).
  Keep it to yourself; never paste it into an issue.

The first start downloads the package, so it can take a moment.

## Claude Desktop

Following the Model Context Protocol's guide,
[Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers):

1. In the Claude menu (the menu bar, not the chat window), choose **Settings…**, then
   **Developer**, then **Edit Config**. This opens `claude_desktop_config.json`:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. Add an `nyc-311` entry inside `mcpServers`. If the file is empty, use all of this:

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

   If the file already lists other servers, add only the `"nyc-311": { … }` part, with a
   comma after the entry before it. No API key? Leave out the whole `"env"` part and the
   comma before it.
3. Save the file, **quit Claude Desktop completely**, and open it again.
4. To check it worked, ask Claude "Which nyc-311 tools do you have?" You should see 23,
   including `draft_311_report`.

If it doesn't show up, the same guide's
[Troubleshooting](https://modelcontextprotocol.io/docs/develop/connect-local-servers#troubleshooting)
section explains where Claude Desktop keeps its logs (`~/Library/Logs/Claude` on a Mac,
`%APPDATA%\Claude\logs` on Windows).

## Claude Code

Following [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp), in a
terminal:

```bash
claude mcp add --env NYC_311_API_KEY=your_key_here --transport stdio nyc-311 \
  -- npx -y @betanyc/nyc-311-mcp
```

No API key? Leave out `--env NYC_311_API_KEY=your_key_here`. By default the server is added
for the current project only; add `--scope user` to use it in every project. Check it with
`claude mcp get nyc-311`, which should say `Connected`.

## Already using 1.1.0, or tried the beta?

`npx` keeps a copy of what it downloaded. If you still see 4 tools, quit your app, delete the
`_npx` folder in npm's cache (`~/.npm/_npx` on a Mac or Linux, `%LOCALAPPDATA%\npm-cache\_npx`
on Windows), and open the app again.

If you tested the beta under the name `nyc-311-beta`, you can remove it now. In Claude Code:
`claude mcp remove nyc-311-beta` (add `--scope user` if you added it that way). In Claude
Desktop, delete the `nyc-311-beta` entry from `claude_desktop_config.json`.

## The data cache

The district tools download BoardStat's files the first time they need them, and the 311
article text is saved for a week, so later answers are fast. The cache is about 85 MB of
public City data, nothing personal:

- macOS: `~/Library/Caches/nyc-311-mcp`
- Windows: `%LOCALAPPDATA%\nyc-311-mcp\Cache`
- Linux: `~/.cache/nyc-311-mcp` (or `$XDG_CACHE_HOME/nyc-311-mcp`)

To use another folder, set `NYC_311_MCP_CACHE_DIR`. To clear it, quit your AI app and delete
that folder. It's rebuilt the next time a tool needs it.

## What to try

Ask in your own words. You don't need the tool names. The [tools page](tools.html) has things
to ask for each tool, and a replay of a real answer.

## Safety, plainly

- **Nothing is ever filed.** `how_to_report` and `draft_311_report` never submit a report,
  send anything, or fill in a form. You report the problem yourself on 311 Online, in the 311
  app, or by calling 311.
- **Danger detection looks for words and phrases, and it will miss some emergencies.** Every
  answer ends with "For informational purposes only. BetaNYC builds these answers from City
  data; they may contain errors. Check the City's 311 page before you report. If this is an
  emergency, or if you think this is an emergency, call 911."
- Numbers come from NYC Open Data through BoardStat and BetaNYC's own code. They aren't
  official City statistics. 311 counts are reports, not problems, and "closed" doesn't mean
  fixed.

## Tell us what you find

[Open an issue](https://github.com/BetaNYC/nyc-311-mcp/issues/new). Tell us which tool, what
you asked, what you got, and what you expected. GitHub issues are public, so leave out names,
phone numbers, home addresses, 311 request numbers, and your API key. A street corner or a
district is enough.
