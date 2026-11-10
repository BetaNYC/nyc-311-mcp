# site-src

Makes the website's two HTML pages (`docs/index.html`, `docs/tools.html`) and the README's
tool listing.

1. `npm run build`, then `python3 site-src/capture.py` with `NYC_311_API_KEY` set. It asks
   the beta one real question per demo and saves the answers to `captures.json`
   (git-ignored, because answers can hold addresses). To ask the copy testers install
   instead of your local build, add `N311_CMD="npx -y github:BetaNYC/nyc-311-mcp#main"`, with
   `NYC_311_MCP_CACHE_DIR` set to an empty folder so no old data is reused.
2. `python3 site-src/build.py` writes the two pages. It stops if any demo line is not word
   for word in its real answer. If the answers changed, update the demo lines in `spec.py`.
3. `python3 site-src/build_readme.py` writes `README.md` from `readme_template.md` and the
   tool text in `spec.py`. Edit the template, not `README.md`.

Tool descriptions and sample questions live in `spec.py`, so the site and the README say
the same thing.
