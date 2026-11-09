---
title: Test the nyc-311-mcp beta
---

# Test the nyc-311-mcp beta

[Beta MCPs](index.md) › nyc-311-mcp

This is the next big version of `@betanyc/nyc-311-mcp`, the MCP server that lets an AI
assistant answer questions about NYC 311. It is **not released yet**. Thank you for
trying it.

## The short version

- The beta has **21 tools**. The released version has 4.
- It runs straight from a GitHub branch named `beta`. Nothing is
  published to npm, and people on the released version are not affected.
- It may change from one day to the next. Quit and reopen your AI app to pick up the
  newest build.
- **The reporting tools never file anything with 311.** They help you write a report
  that you submit yourself.
- **In an emergency, call 911.** Do not rely on an AI assistant to notice danger:
  danger detection is keyword-based and will miss some emergencies.

## What is new

| Tools | What they do | Needs the 311 API key? |
|---|---|---|
| **District tools** (11): `find_district`, `district_summary`, `top_problems`, `problem_trend`, `agency_response`, `still_open`, `top_addresses`, `address_history`, `find_requests`, `boardstat_link`, `boardstat_status` | Answer questions about a community district or Council district from the files [BoardStat](https://www.beta.nyc/boardstat/) publishes every night. The numbers should match the BoardStat page each answer links to. | No |
| **Local Law 47 of 2005 reports** (3): `ll47_service_request_report`, `ll47_directory_assistance_report`, `cb_monthly_list` | Rebuild, from NYC Open Data, the reports Local Law 47 of 2005 put in Charter § 1075 (two have since been repealed); the directory-assistance report is limited. These are BetaNYC rebuilds, **not the City's official reports**. | No |
| **Request lookup** (2, improved): `get_service_request`, `get_service_request_list` | Look up a 311 request by its number (`311-XXXXXXXX`), now with a plain-language reading of its status. | Yes |
| **Reporting help** (3): `how_to_report`, `list_311_categories`, `draft_311_report` | From a plain description ("a pothole on my block"), find the 311 article that fits, the agency, and how to report it, then draft text you can paste into 311 Online yourself. | Yes |
| **Unchanged** (1): `get_calendar` | Alternate-side parking, collections and schools. | Yes |
| **Status, improved** (1): `get_status` | Whether Code Blue, a hydrant, snow or ice, or an OEM emergency is in effect now, in words. | Yes |

Full details are in the branch's
[README](https://github.com/BetaNYC/nyc-311-mcp/blob/beta/README.md).

## Before you start

You need:

- **Node.js 18 or later.** Check with `node --version` in a terminal. Get it from
  [nodejs.org](https://nodejs.org/) (the LTS version) if it is missing or older.
- **git.** Check with `git --version`. Get it from
  [git-scm.com](https://git-scm.com/downloads) if it is missing.
- **An AI app that supports MCP.** This page covers Claude Desktop and Claude Code.
- **Optional: a free NYC 311 API key**, only for the tools marked "Yes" above. The
  district tools and the Local Law 47 reports work without one. To get a key, sign in at
  [api-portal.nyc.gov](https://api-portal.nyc.gov/), subscribe to **NYC 311 Public
  Developers**, and copy a key from your
  [profile page](https://api-portal.nyc.gov/profile). Keep it to yourself; never paste
  it into an issue.

The first start downloads and builds the beta, so it can take a minute. Later starts
are faster.

**The beta installs from GitHub, not npm.** `npx` asks git to fetch the `beta` branch.
That works over HTTPS with no GitHub account. If your computer has GitHub SSH keys set up,
git may use SSH instead, which also works. If the install stops with
`Permission denied (publickey)`, git tried SSH without a key: tell us in a feedback issue,
and in the meantime set up an SSH key or ask us for help.

**It keeps a data cache of about 85 MB** (more if you ask a citywide question with
`read_every_district`). The district tools download BoardStat's files the first time they
need them, and the 311 article text is saved for a week, so later answers are fast. The
cache is in:

- macOS: `~/Library/Caches/nyc-311-mcp`
- Windows: `%LOCALAPPDATA%\nyc-311-mcp\Cache`
- Linux: `~/.cache/nyc-311-mcp` (or `$XDG_CACHE_HOME/nyc-311-mcp`)

To use another folder, set `NYC_311_MCP_CACHE_DIR`. To clear the cache, quit your AI app
and delete that folder (on a Mac: `rm -rf ~/Library/Caches/nyc-311-mcp`). It is rebuilt
the next time a tool needs it. Nothing in it is personal: it holds public City data only.

## Install the beta

The beta runs with this command (you do not need to type it yourself; your app runs it):

```bash
npx -y github:BetaNYC/nyc-311-mcp#beta
```

If you already use the released nyc-311-mcp, turn it off while you test, so you know
which one is answering.

### Claude Desktop

Following the Model Context Protocol's guide,
[Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers):

1. In the Claude menu (the menu bar, not the chat window), choose **Settings…**, then
   **Developer**, then **Edit Config**. This opens `claude_desktop_config.json`:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. Add a `nyc-311-beta` entry inside `mcpServers`. If the file is empty, use all of this:

   ```json
   {
     "mcpServers": {
       "nyc-311-beta": {
         "command": "npx",
         "args": ["-y", "github:BetaNYC/nyc-311-mcp#beta"],
         "env": {
           "NYC_311_API_KEY": "your_key_here"
         }
       }
     }
   }
   ```

   If the file already lists other servers, add only the `"nyc-311-beta": { … }` part,
   with a comma after the entry before it. For example, a file that already had a
   `filesystem` server would end up like this:

   ```json
   {
     "mcpServers": {
       "filesystem": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/username/Desktop"]
       },
       "nyc-311-beta": {
         "command": "npx",
         "args": ["-y", "github:BetaNYC/nyc-311-mcp#beta"],
         "env": {
           "NYC_311_API_KEY": "your_key_here"
         }
       }
     }
   }
   ```

   Before saving, you can paste the whole file into a JSON validator to catch a missing
   comma or brace (remove your API key first if the validator is a website). No API key? Leave out the whole `"env"` part
   (and the comma before it); the district tools and the reports still work.
3. Save the file, **quit Claude Desktop completely**, and open it again.
4. To check it worked: in a chat, open the **+** menu by the message box, then
   **Connectors** › **Manage connectors**, and look for `nyc-311-beta`. Or ask Claude
   "Which nyc-311 tools do you have?" You should see 21, including `draft_311_report`.
   The beta calls itself version `1.2.0-beta.4` (the released version is 1.1.0); your
   app's MCP or connector settings show it.

If it does not show up, the same guide's
[Troubleshooting](https://modelcontextprotocol.io/docs/develop/connect-local-servers#troubleshooting)
section explains where Claude Desktop keeps its logs (`~/Library/Logs/Claude` on a Mac, `%APPDATA%\Claude\logs` on Windows).

### Claude Code

Following [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp), in
a terminal:

```bash
claude mcp add --env NYC_311_API_KEY=your_key_here --transport stdio nyc-311-beta \
  -- npx -y github:BetaNYC/nyc-311-mcp#beta
```

No API key? Leave out `--env NYC_311_API_KEY=your_key_here`. By default the server is
added for the current project only; add `--scope user` to use it in every project.
Check it with `claude mcp get nyc-311-beta`, which should say `Connected`.

## What to test

Try real questions in your own words. You do not need to use the tool names. Some
starting points:

### District tools

- "What were the top 311 problems in Brooklyn Community District 6 last month?" Board
  codes work too: "BK06", "MN03", "Brooklyn 6".
- "Which agency is slowest to close requests in Council District 7 this fiscal year?"
- "How have noise complaints in Manhattan Community District 3 changed over the last
  year, compared with the year before?"
- "What 311 requests are still open in Bronx Community District 1, oldest first?"
- "What has been reported at City Hall?" or at a park or library you know. For address
  tests, use a public place, not a home address.
- "How fresh is BoardStat's data?"

**Compare one number with [BoardStat](https://www.beta.nyc/boardstat/).** Every answer
includes a BoardStat link with the same district, dates and problems. Open it and check
that the totals match. A mismatch is exactly what we want to hear about.

### Local Law 47 of 2005 reports

- "Rebuild the Local Law 47 service request report for October for Queens."
- "Give me the monthly list of requests for Staten Island Community District 1 for
  October."

Check that each answer says which Charter section it rebuilds, whether that section is
still law, and that it is not the City's official report.

### Request lookup (needs the API key)

- "What is the status of 311 request 311-XXXXXXXX?" using a request number you have.
  Do not copy the number or the answer into a feedback issue; describe what went wrong
  instead.
- Is the plain-language status clear? Does it match what the 311 portal tells you?

### Reporting help (needs the API key)

- Everyday problems: "There's a pothole on my block." "My neighbor's dog barks all
  night." "No heat in my apartment." "A streetlight is out on my corner."
- Several at once: "Overflowing trash can and a broken bench in the park."
- Ask for a draft: "Help me write a 311 report about a broken traffic light at
  Broadway and W 96 St in Manhattan."
- **Emergency phrasings**, to check the safety behavior: "I smell gas in my building."
  "Someone is lying on the sidewalk and not moving." "There's a downed power line
  sparking on my street." For these, **the first line must tell you to call 911**, and
  `draft_311_report` should not write a draft.

For each: did it pick the right 311 article and agency? Is the link right? Did the
draft make anything up, or did it ask you (marked `[add: …]`) for what was missing?

## Safety, plainly

- **Nothing is ever filed.** `how_to_report` and `draft_311_report` never submit a
  report, send anything, or fill in a form. You submit the report yourself on 311
  Online, the 311 app, or by calling 311.
- **Danger detection is keyword-based, and it will miss some emergencies.** Every answer
  starts with "If anyone is in danger right now, call 911." Do not count on the tool to
  recognize an emergency.
- **In an emergency, call 911.**
- Numbers come from NYC Open Data through BoardStat and BetaNYC's own code. They are not
  official City statistics. 311 counts are reports, not problems, and "closed" does not
  mean fixed.

## How to give feedback

[Open a beta feedback issue](https://github.com/BetaNYC/nyc-311-mcp/issues/new?template=beta-feedback.yml).
The form asks which tool, what you asked, what you got, what you expected, and which
app you used. You can paste the assistant's answer.

GitHub issues are public. **Leave out personal information**: names, phone numbers,
email addresses, your home address, and your API key. A street corner or a district is
enough. **Don't paste a 311 request number or an answer about a home address. Replace
the address with the nearest corner.**

## Switch back to the released version

### Claude Desktop

In `claude_desktop_config.json`, delete the `nyc-311-beta` entry, or change its `args`
to the released package:

```json
"args": ["-y", "@betanyc/nyc-311-mcp"]
```

Then quit and reopen Claude Desktop.

### Claude Code

```bash
claude mcp remove nyc-311-beta
```

If you added it with `--scope user`, remove it with
`claude mcp remove nyc-311-beta --scope user`. To go back to the released version:

```bash
claude mcp add --env NYC_311_API_KEY=your_key_here --transport stdio nyc-311 \
  -- npx -y @betanyc/nyc-311-mcp
```

---

Built by [BetaNYC](https://beta.nyc). An independent, community-built project, not
affiliated with, endorsed by, or an official product of the City of New York.

<!--
Maintainers: the `beta` branch is not a release. It is updated only by fast-forwarding
it to the branch under test (the epic #12 stack is merged to main; beta fixes go on a
branch from main), e.g. `git push origin origin/<branch>:refs/heads/beta`. No force
pushes, so testers' installs never jump backward or to unrelated history.
-->
