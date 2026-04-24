# @webfetch/server

Local HTTP server that exposes the `@webfetch/core` surface over
`127.0.0.1:7600`. Designed to be called by the webfetch Chrome extension
and by `curl` during development.

## Run

```bash
bun run --cwd packages/server src/index.ts
# or, from npm:
npx -y @webfetch/server -- --port 7600
```

On first boot the server writes a random 32-byte hex token to
`~/.webfetch/server.token`, prints it to stdout, and (unless `--no-open`)
opens `http://127.0.0.1:7600/auth/display` in your default browser where
you can copy it into the extension's options page.

## Endpoints

All endpoints require `Authorization: Bearer <token>`. POST endpoints
take a JSON body that mirrors the corresponding MCP tool's input schema
from `@webfetch/mcp`.

| Method | Path              | Mirrors MCP tool     |
|--------|-------------------|----------------------|
| GET    | `/health`         | —                    |
| GET    | `/providers`      | —                    |
| GET    | `/auth/display`   | (public, HTML page)  |
| POST   | `/search`         | `search_images`      |
| POST   | `/artist`         | `search_artist_images` |
| POST   | `/album`          | `search_album_cover` |
| POST   | `/download`       | `download_image`     |
| POST   | `/probe`          | `probe_page`         |
| POST   | `/license`        | `fetch_with_license` |
| POST   | `/similar`        | `find_similar`       |

Responses are `{ ok: true, data }` on success, `{ ok: false, error }` on
failure (status 4xx/5xx).

## Flags

- `--port <n>` (default `7600`)
- `--host <addr>` (default `127.0.0.1`; do not change unless you know why)
- `--no-open` skip opening the auth-display page
- `--regenerate-token` force a fresh token on boot

## Security

- Bound to `127.0.0.1` only
- Bearer token required on every non-preflight request
- CORS allow-list: `chrome-extension://*`, `moz-extension://*`,
  `http://127.0.0.1[:*]`, `http://localhost[:*]`, null/missing
- No `0.0.0.0` binding, no remote callers
