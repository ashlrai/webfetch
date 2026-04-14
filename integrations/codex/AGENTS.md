# Codex agent notes

This project uses [web-fetcher-mcp](https://github.com/ashlr-ai/web-fetcher-mcp)
for every image lookup. Do not download images directly from the web.

## Preferred workflow

1. Call `webfetch search "<query>"` (or the MCP `search_images` tool) to get
   license-filtered candidates.
2. For artists or albums use the specialized commands:
   - `webfetch artist "<name>" --kind portrait|album|logo|performing`
   - `webfetch album "<artist>" "<album>"`
3. Only `licensePolicy: "safe-only"` is acceptable for shipped content.
   `UNKNOWN` licenses are never trusted.
4. Persist the `attributionLine` from the chosen candidate alongside the file.

## CLI invocation

```
webfetch search "<query>" --json --limit 5
webfetch download <url> --out ./assets/foo.jpg --json
```

## MCP tools (when available)

- `search_images`
- `search_artist_images`
- `search_album_cover`
- `download_image`
- `probe_page`
- `license_for_url`
- `list_providers`

## Guardrails

- Never enable the `browser` provider without explicit user consent; it
  scrapes images.google.com and is ToS-grey.
- Always check `candidate.licenseConfidence >= 0.5` before shipping.
- Prefer `CC0` / `PUBLIC_DOMAIN` / `CC_BY` over `EDITORIAL_LICENSED` unless
  the use case is editorial (artist/album pages).
