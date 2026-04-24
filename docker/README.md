# webfetch — Docker image

Multi-stage image: Bun-built artifacts, Node 20 slim runtime. Ships `cli`,
`server`, and `mcp` behind a single entrypoint.

## Published tags

- `ghcr.io/ashlrai/webfetch:latest`
- `ghcr.io/ashlrai/webfetch:<semver>` (e.g. `1.2.3`, `1.2`)

Built + pushed by `.github/workflows/docker.yml` on every `v*` tag.

## Run

```bash
# CLI — default entrypoint
docker run --rm ghcr.io/ashlrai/webfetch cli providers
docker run --rm ghcr.io/ashlrai/webfetch cli search "drake portrait" --limit 5

# Local HTTP server (port 7600)
docker run --rm -p 7600:7600 ghcr.io/ashlrai/webfetch server --host 0.0.0.0 --no-open

# MCP stdio server (typically invoked by an agent, not directly)
docker run --rm -i ghcr.io/ashlrai/webfetch mcp

# Pass provider keys
docker run --rm \
  -e UNSPLASH_ACCESS_KEY=... \
  -e PEXELS_API_KEY=... \
  ghcr.io/ashlrai/webfetch cli search "sunset" --providers unsplash
```

## Build locally

From the repo root:

```bash
docker build -f docker/Dockerfile -t webfetch:local .
docker run --rm webfetch:local cli --help
```

## Persisting the cache

The content-addressed cache lives at `~/.webfetch/cache/` inside the container.
The local server token is written to `~/.webfetch/server.token`. Mount a host
volume to keep both cache and token stable across runs:

```bash
docker run --rm \
  -v "$HOME/.webfetch:/root/.webfetch" \
  ghcr.io/ashlrai/webfetch cli search "sunset"
```
