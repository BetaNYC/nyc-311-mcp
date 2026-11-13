"""Builds docs/index.html and docs/tools.html for the nyc-311-mcp site.

Every demo line is checked against the real answers in captures.json: a line that
does not appear word for word in its answer stops the build.
"""
import html, json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import spec

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "docs"
caps = json.load(open(HERE / "captures.json"))
SAFETY = ("For informational purposes only. BetaNYC builds these answers from City data; they may "
          "contain errors. Check the City's 311 page before you report. If this is an emergency, "
          "or if you think this is an emergency, call 911.")
REPO = "https://github.com/BetaNYC/nyc-311-mcp"
e = html.escape


def lines_of(cap):
    return {l.strip().rstrip(",") for l in cap["text"].splitlines()}


errors = []


def demo(name, d, n):
    cap = caps[d["capture"]]
    if cap["tool"] != name:
        errors.append(f"{name}: capture {d['capture']} is {cap['tool']}")
    have = lines_of(cap)
    for l in d["lines"]:
        if l != "…" and l not in have:
            errors.append(f"{name}: not in the real answer: {l}")
    if not cap["text"].rstrip().endswith(SAFETY):
        errors.append(f"{name}: real answer does not end with the safety line")
    args = ", ".join(f"{k}={json.dumps(v)}" for k, v in cap["args"].items())
    body = "\n".join(
        f'<span class="step gap">…</span>' if l == "…" else f'<span class="step">{e(l)}</span>'
        for l in d["lines"]
    )
    return f"""<figure class="demo static" aria-label="Example: {e(d['prompt'])}">
  <div class="demo-bar"><span>A real question and answer, {e(spec.CAPTURED)}. Answer shortened.</span><button type="button" class="replay">Replay</button></div>
  <div class="demo-body">
    <p class="msg-user"><span class="typed" data-text="{e(d['prompt'])}">{e(d['prompt'])}</span></p>
    <p class="call step">The assistant calls <span class="name">{e(name)}</span>({e(args)})</p>
<pre class="answer">{body}
<span class="step closing">{e(SAFETY)}</span></pre>
    <figcaption class="caption step">{e(d['caption'])}</figcaption>
  </div>
</figure>"""


def page(title, current, main, desc):
    nav = [("index.html", "Home"), ("tools.html", "Tools"), ("install.html", "Install"), (REPO, "GitHub")]
    links = " ".join(
        f'<a href="{h}"{" aria-current=\"page\"" if h == current else ""}>{t}</a>' for h, t in nav
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="stylesheet" href="assets/site.css">
<script src="assets/demo.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site"><a class="brand" href="index.html">NYC 311 MCP</a><span class="tag">1.3</span>
<nav class="site-nav" aria-label="Site">{links}</nav></header>
<main id="main"><div class="wrap">
{main}
</div></main>
<footer class="site"><div class="wrap">
<p>Built by <a href="https://beta.nyc">BetaNYC</a>, New York's civic technology and open data community. Free and open source under the MIT License. <a href="{REPO}">Code on GitHub</a>. <a href="whats-changed.html">What's changed</a>.</p>
<p>An independent, community-built project. Not affiliated with, endorsed by, or an official product of the City of New York.</p>
<p>{e(SAFETY)}</p>
<p><a href="https://beta.nyc/donate/">Support our work</a>.</p>
</div></footer>
</body>
</html>
"""


BADGE = {"new13": '<span class="badge new">New in 1.3.0</span>',
         "new": '<span class="badge new">New in 1.2.0</span>',
         "improved": '<span class="badge">Improved in 1.2.0</span>',
         "same": '<span class="badge">Same as 1.1.0</span>'}


def tool_block(name, n):
    t = spec.TOOLS[name]
    key = ('<span class="badge key">Needs a free 311 API key</span>' if t["key"]
           else '<span class="badge nokey">No key needed</span>')
    asks = "".join(f"<li>“{e(a)}”</li>" for a in t["asks"])
    out = [f'<section class="tool" id="{name}">',
           f"<h3><code>{name}</code></h3>",
           f'<div class="badges">{BADGE[t["status"]]}{key}</div>',
           f"<p>{e(t['what'])}</p>",
           f'<p><strong>Try asking:</strong></p><ul class="asks">{asks}</ul>']
    for k in ("demo", "demo2"):
        if k in t:
            out.append(demo(name, t[k], n))
    out.append("</section>")
    return "\n".join(out)


# ---- tools.html
toc = []
blocks = []
for g in spec.GROUPS:
    toc.append(f'<li><a href="#{g["id"]}">{e(g["title"])}</a> ({len(g["tools"])})</li>')
    blocks.append(f'<h2 id="{g["id"]}">{e(g["title"])}</h2>\n<p>{g["intro"]}</p>')
    for name in g["tools"]:
        blocks.append(tool_block(name, len(blocks)))
count = sum(len(g["tools"]) for g in spec.GROUPS)
assert count == 24 and set(spec.TOOLS) == {t for g in spec.GROUPS for t in g["tools"]}, count
tools_main = f"""<h1>Every tool</h1>
<p class="lede">nyc-311-mcp has 24 tools. You don't need to know their names. Ask your question in plain English and your AI assistant picks the tool. Below is what each one does, a few things to try, and a replay of a real question and answer.</p>
<div class="safety"><p><strong>If this is an emergency, or if you think this is an emergency, call 911.</strong> Every answer from every tool ends with that line. Danger detection is a best effort and it will miss some emergencies.</p></div>
<p>The demos are real answers, captured {e(spec.CAPTURED)}, with BoardStat data as of {e(spec.BOARDSTAT_AS_OF)}. We shortened them to fit, and left out home addresses. Your numbers will be newer.</p>
<ol class="toc">{''.join(toc)}</ol>
{chr(10).join(blocks)}
<h2>Want to try it?</h2>
<p><a class="button" href="install.html">Install it</a></p>
"""
(OUT / "tools.html").write_text(page("Every tool in the NYC 311 MCP", "tools.html", tools_main,
    "What each of the 24 tools in nyc-311-mcp does, with things to ask and real answers."))

# ---- index.html
pot = demo("how_to_report", spec.TOOLS["how_to_report"]["demo"], 0)
smoke = demo("how_to_report", spec.TOOLS["how_to_report"]["demo2"], 1)
cards = "".join(
    f'<div class="card"><h3>{e(g["title"])}</h3><p class="count">{len(g["tools"])} tool{"s" if len(g["tools"]) > 1 else ""}</p>'
    f'<p><a href="tools.html#{g["id"]}">See them</a></p></div>'
    for g in spec.GROUPS)
index_main = f"""<h1>Ask your AI assistant about NYC 311</h1>
<p class="lede">nyc-311-mcp connects an AI assistant like Claude to New York City's 311 data. Ask it how to report a problem, what your community district complains about most, how long agencies take to close requests, or whether alternate side parking is on today. It answers from the City's own data and shows you where each answer came from.</p>
<p>We built it at <a href="https://beta.nyc">BetaNYC</a>. It's free, it's open source, and it never files anything with 311 for you.</p>
<p><a class="button" href="tools.html">See all 24 tools</a> <a class="button secondary" href="install.html">Install it</a></p>

<div class="safety"><p><strong>If this is an emergency, or if you think this is an emergency, call 911.</strong> Every answer from every tool ends with that line. The answers are for information only, BetaNYC builds them from City data, and they may contain errors. Check the City's 311 page before you report.</p></div>

<h2>See it work</h2>
<p>A neighbor asks about a pothole. The assistant finds the City's 311 article for it and counts how often people in the same district reported it.</p>
{pot}
<p>Some things shouldn't go to 311 at all. When a description sounds dangerous, the first line says to call 911.</p>
{smoke}

<h2>Versions</h2>
<p>Version 1.1.0 had 4 tools: the 311 calendar, status alerts, and request lookup. Version 1.2.0 had 21. It added help reporting a problem, district numbers from BoardStat, and the Local Law 47 reports. Version 1.3.0 adds three tools: one tells you what changed in the server, one says who built it, and one says where its data comes from. The package is <code>@betanyc/nyc-311-mcp</code> on npm, and the <a href="whats-changed.html">What's changed</a> page says when each version was released.</p>
<p>Install it in Claude Desktop, Claude Code, or any MCP app: <a href="install.html">install guide</a>.</p>

<h2>What it can do</h2>
<div class="cards">{cards}</div>

<h2>Before you rely on an answer</h2>
<ul>
<li>311 counts are reports, not problems. They show who reports and how, and not only how many problems there are.</li>
<li>"Closed" means an agency closed the request. It doesn't mean the problem was fixed. Read the agency's resolution text.</li>
<li>The district numbers come from BoardStat, built every night from NYC Open Data. They aren't official City statistics. Each answer links to the BoardStat page, so you can check.</li>
<li>We left ZIP codes out on purpose. ZIP codes are mail routes, not City districts.</li>
</ul>

<h2>Tell us what you find</h2>
<p>If an answer is wrong, confusing, or missing something, <a href="{REPO}/issues/new">open an issue</a>. GitHub issues are public, so leave out names, phone numbers, home addresses, and your API key. A street corner or a district is enough.</p>
"""
(OUT / "index.html").write_text(page("NYC 311 MCP: ask your AI assistant about NYC 311", "index.html", index_main,
    "A free, open-source MCP server from BetaNYC that lets AI assistants answer questions about NYC 311."))

if errors:
    print("\n".join(errors))
    sys.exit(1)
print("built, all demo lines verified")
