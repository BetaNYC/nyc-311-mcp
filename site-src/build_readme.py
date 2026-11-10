import json, re, sys, pathlib
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import spec
tools = {t['name']: t for t in json.load(open(HERE / 'tools.json'))}
def md(h):  # the group intros carry a few <a> links
    return re.sub(r'<a href="([^"]+)">([^<]+)</a>', r'[\2](\1)', h)
STATUS = {"new": "New in 1.2.0", "improved": "Improved in 1.2.0", "same": "Same as 1.1.0"}
out = []
for g in spec.GROUPS:
    out.append(f"#### {g['title']}\n\n{md(g['intro'])}\n")
    for name in g['tools']:
        t = spec.TOOLS[name]
        key = "needs the free 311 API key" if t['key'] else "no key needed"
        req = set(tools[name]['inputSchema'].get('required') or [])
        props = list(tools[name]['inputSchema'].get('properties', {}))
        inputs = ", ".join(f"`{p}`" + (" (required)" if p in req else "") for p in props) or "none"
        asks = "\n".join(f"  - “{a}”" for a in t['asks'])
        out.append(f"- **`{name}`** ({STATUS[t['status']]}; {key}). {t['what']}\n"
                   f"  - Try asking:\n{asks.replace('  - ', '    - ')}\n"
                   f"  - Inputs: {inputs}\n")
    out.append("")
s = open(HERE / 'readme_template.md').read()
lic = open(HERE.parent / 'LICENSE').read().split('\n', 3)[3].strip()
s = s.replace('{BETA_TOOLS}', "\n".join(out).rstrip()).replace('{LICENSE_BODY}', lic)
open(HERE.parent / 'README.md', 'w').write(s)
print(len(s.splitlines()), 'lines')
