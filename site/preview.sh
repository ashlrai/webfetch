#!/usr/bin/env bash
# Tiny static preview server for the landing page.
# Tries python3, then bun, then node's http-server equivalents.

set -euo pipefail

PORT="${PORT:-4173}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "Serving $DIR on http://localhost:$PORT"

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v bun >/dev/null 2>&1; then
  exec bun --hot <(cat <<'EOF'
Bun.serve({
  port: Number(process.env.PORT || 4173),
  fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/index.html";
    return new Response(Bun.file("." + p));
  },
});
EOF
)
elif command -v python >/dev/null 2>&1; then
  exec python -m SimpleHTTPServer "$PORT"
else
  echo "No python3 or bun on PATH. Install one and re-run." >&2
  exit 1
fi
