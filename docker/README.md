# webfetch — Docker image

Multi-stage image: Bun-built artifacts, Node 20 slim runtime. Ships `cli`,
`server`, and `mcp` behind a single entrypoint.

## Published tags

- `ghcr.io/ashlr-ai/webfetch:latest`
- `ghcr.io/ashlr-ai/webfetch:<semver>` (e.g. `1.2.3`, `1.2`)

Built + pushed by `.github/workflows/docker.yml` on every `v*` tag.

## Run

```bash
# CLI — default entrypoint
docker run --rm ghcr.io/ashlr-ai/webfetch cli providers
docker run --rm ghcr.io/ashlr-ai/webfetch cli search "drake portrait" --limit 5

# Local HTTP server (port 7600)
docker run --rm -p 7600:7600 ghcr.io/ashlr-ai/webfetch server

# MCP stdio server (typically invoked by an agent, not directly)
docker run --rm -i ghcr.io/ashlr-ai/webfetch mcp

# Pass provider keys
docker run --rm \
  -e UNSPLASH_ACCESS_KEY=... \
  -e PEXELS_API_KEY=... \
  ghcr.io/ashlr-ai/webfetch cli search "sunset" --provider unsplash
```

## Build locally

From the repo root:

```bash
docker build -f docker/Dockerfile -t webfetch:local .
docker run --rm webfetch:local cli --help
```

## Persisting the cache

The content-addressed cache lives at `~/.webfetch/cache/` inside the container.
Mount a host volume to keep it warm across runs:

```bash
docker run --rm \
  -v "$HOME/.webfetch/cache:/root/.webfetch/cache" \
  ghcr.io/ashlr-ai/webfetch cli search "sunset"
```
