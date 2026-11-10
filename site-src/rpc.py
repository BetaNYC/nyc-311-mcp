import json, subprocess, sys, os, pathlib
def start():
    # N311_CMD runs the server another way, such as the GitHub install testers use:
    #   N311_CMD="npx -y github:BetaNYC/nyc-311-mcp#main"
    cmd = os.environ.get("N311_CMD", "").split() or ["node", str(pathlib.Path(__file__).resolve().parent.parent / "dist" / "index.js")]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=os.environ)
    def send(m): p.stdin.write(json.dumps(m) + "\n"); p.stdin.flush()
    def recv(i):
        while True:
            r = json.loads(p.stdout.readline())
            if r.get("id") == i: return r
    send({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"site","version":"1"}}}); recv(0)
    send({"jsonrpc":"2.0","method":"notifications/initialized"})
    return p, send, recv
