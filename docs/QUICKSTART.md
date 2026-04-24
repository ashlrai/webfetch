# Quickstart

Four install paths, depending on how you intend to call webfetch. Pick one
and verify it works before moving on.

## 0. One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/ashlrai/webfetch/main/install/install.sh | bash
```

This clones the repo to `~/.webfetch/repo`, installs bun if missing, builds
the CLI, symlinks `webfetch` onto `$PATH`, and merges the MCP entry into
`~/.claude/settings.json` (with consent). Re-run any time to update.

Non-interactive variant for CI and Dockerfiles:

```bash
curl -fsSL https://raw.githubusercontent.com/ashlrai/webfetch/main/install/install.sh | bash -s -- --yes --no-claude
```

## 1. CLI

Verify:

```bash
webfetch version
webfetch providers
webfetch search "drake portrait" --limit 3
```

Expected: a table of 3 candidates with license tags and confidence scores.
Exit code `0`.

## 2. MCP server (Claude Code / Cursor / Cline / Continue / Roo Code)

1. Run the installer above, OR copy the matching snippet from
   [`integrations/`](../integrations/) into your agent's MCP config.
2. Restart the agent.
3. Verify: ask the agent to call `search_images` for a simple query, or run
   `webfetch providers` locally. The registry has 24 providers and 19 defaults.

Per-agent details:

- [Claude Code](./INSTALL_CLAUDE_CODE.md)
- [Cursor](./INSTALL_CURSOR.md)
- [Cline](./INSTALL_CLINE.md)

## 3. Standalone HTTP server

```bash
cd ~/.webfetch/repo
bun run --cwd packages/server start
```

Verify:

```bash
TOKEN="$(cat ~/.webfetch/server.token)"
curl -sS -X POST http://127.0.0.1:7600/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"drake portrait","licensePolicy":"safe-only"}' \
  | jq '.data.candidates[0]'
```

## 4. Chrome extension

The extension lives at `extension/` in the repo and is loaded as an
unpacked extension via `chrome://extensions`. See that directory's README
for packaging details.

## 5. GitHub Action (CI / build-time enrichment)

No local install needed:

```yaml
- uses: ashlrai/webfetch/integrations/github-action@main
  with:
    query: "..."
    out-dir: ./assets
```

See [`integrations/github-action/README.md`](../integrations/github-action/README.md).
