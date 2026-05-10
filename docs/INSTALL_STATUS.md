# Install And Integration Status

| Surface | Primary command | Status | Notes |
| --- | --- | --- | --- |
| npm CLI | `npm i -g getwebfetch` | Canonical | Provides `webfetch`; default mode runs local core. Use `--cloud` with `WEBFETCH_API_KEY` for hosted API calls. |
| Docker | `docker run --rm ghcr.io/ashlrai/webfetch cli help` | Supported | Uses the same TypeScript CLI entrypoint. |
| Homebrew | `brew install ashlrai/webfetch/webfetch` | Supported after release | Equivalent to `brew tap ashlrai/webfetch && brew install webfetch`; formula points at the npm CLI tarball. |
| curl installer | `bash install/install.sh` | Supported | Builds the TypeScript CLI from source. |
| Python SDK | `pip install webfetch` | SDK | Console script is `webfetch-py` so it does not shadow the TypeScript CLI. Cloud calls use `/v1/*`; custom self-hosted URLs keep unversioned compatibility routes. |
| MCP | `getwebfetch-mcp` | Supported | Thin bridge over core. Search responses are concise and include CLI handoff commands for batch work. |
| Glama | root `Dockerfile` | Listed | Live at <https://glama.ai/mcp/servers/ashlrai/webfetch>; the root Dockerfile starts the MCP stdio server by default for Glama introspection, while the canonical multi-command image remains `docker/Dockerfile`. |
| VS Code | `vscode-extension/` | Supported | Uses the server API and mirrors the current provider/license type list. |
| GitHub Action | `integrations/github-action` | Supported | Manifest records downloaded path, sha256, sidecar, attribution text, and candidate metadata. |

## Mode Matrix

| Surface | Local mode | Cloud mode |
| --- | --- | --- |
| CLI | Default. Runs `webfetch-core` in-process and reads provider keys from env. | `--cloud` or `WEBFETCH_MODE=cloud`; calls `/v1/*` on `WEBFETCH_BASE_URL` or `https://api.getwebfetch.com`. |
| MCP | Default. Runs through `webfetch-core` over stdio. | Use CLI handoff for cloud batch work until MCP grows first-class cloud routing. |
| Python SDK | Custom `base_url`, e.g. `http://127.0.0.1:7600`, uses unversioned self-hosted routes. | Default `https://api.getwebfetch.com`, uses `/v1/*` and `WEBFETCH_API_KEY`. |
| GitHub Action | Runs the packaged CLI in CI. | Set `WEBFETCH_MODE=cloud` and `WEBFETCH_API_KEY` in the workflow env. |

## Release Documentation Checklist

- License taxonomy uses `UNSPLASH_LICENSE`, `PEXELS_LICENSE`, and
  `PIXABAY_LICENSE` instead of treating those providers as `CC0`.
- Batch automation examples use `webfetch batch --jsonl`; each line contains
  `index`, `query`, `status`, `candidateCount`, `candidates`, `top`,
  `downloads`, and provider diagnostics.
- Public install examples prefer the TypeScript CLI name `webfetch`; Python
  keeps `webfetch-py` to avoid shadowing it.
