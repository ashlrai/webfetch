# Quickstart

## MCP in 60 seconds (no clone, no API keys)

The MCP server ships on npm as `getwebfetch-mcp`. Your agent starts it over
stdio with `npx` (Node 18+) or `bunx`. Keyless providers work right away:
Wikimedia Commons, Openverse, iTunes, MusicBrainz CAA, NASA, The Met, Library
of Congress, Internet Archive, Wellcome Collection, Smithsonian (`DEMO_KEY`),
and rawpixel.

Check that it starts. This prints the MCP handshake and then exits:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | npx -y getwebfetch-mcp
# -> {"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"webfetch",...}},...}
```

`bunx getwebfetch-mcp` works the same way. For either one, set `"command": "bunx", "args": ["getwebfetch-mcp"]` in the configs below.

### Claude Desktop

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

(Claude Desktop → Settings → Developer → Edit Config opens it.)

```json
{
  "mcpServers": {
    "webfetch": {
      "command": "npx",
      "args": ["-y", "getwebfetch-mcp"],
      "env": {
        "UNSPLASH_ACCESS_KEY": "",
        "PEXELS_API_KEY": "",
        "PIXABAY_API_KEY": "",
        "BRAVE_API_KEY": ""
      }
    }
  }
}
```

Quit and reopen Claude Desktop. The same file is at
[`integrations/claude-desktop/claude_desktop_config.json`](../integrations/claude-desktop/claude_desktop_config.json).
If the server shows `spawn npx ENOENT`, Claude Desktop can't see the PATH your
shell uses (common with nvm). Set `"command"` to the absolute path from `which npx`.

### Claude Code

```bash
claude mcp add --scope user webfetch -- npx -y getwebfetch-mcp
claude mcp list   # webfetch should be listed as connected
```

Claude Code reads MCP servers from `~/.claude.json` (user or local scope) or
from `.mcp.json` in a project. It **ignores** `mcpServers` in
`~/.claude/settings.json`.

### Cursor

Put this in `~/.cursor/mcp.json` for every project, or in `.cursor/mcp.json` for a single project:

```json
{
  "mcpServers": {
    "webfetch": {
      "command": "npx",
      "args": ["-y", "getwebfetch-mcp"],
      "env": {
        "UNSPLASH_ACCESS_KEY": "",
        "BRAVE_API_KEY": ""
      }
    }
  }
}
```

Then check Cursor Settings → MCP: `webfetch` should show a green dot.

### Provider keys

Keys are optional. A provider without its key is skipped, and the search
result's `providerReports` shows it as `skipped: "missing-auth"`. Fill only the ones you have:
`UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `BRAVE_API_KEY`,
`SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`, `FLICKR_API_KEY`,
`EUROPEANA_API_KEY`, `SMITHSONIAN_API_KEY`, `SERPAPI_KEY` (opt-in),
`BING_API_KEY` (opt-in). Empty strings count as unset.

### Try it

Ask the agent:

> Use webfetch to find a CC0 or public-domain photo of the Golden Gate Bridge, at least 1600px wide, and give me the attribution line.

It should call `search_images`. To go from source instead of npm, use `"command": "bun"`
and `"args": ["run", "<clone>/packages/mcp/src/index.ts"]`.

---

The other install paths are below. Pick one and verify it works before moving on.

## 0. One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/ashlrai/webfetch/main/install/install.sh | bash
```

This clones the repo to `~/.webfetch/repo`, installs bun if missing, builds
the CLI, symlinks `webfetch` onto `$PATH`, and (with consent) registers the
MCP server with Claude Code in `~/.claude.json`. Re-run any time to update.

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

For machine-readable batch work:

```bash
printf "drake portrait\nradiohead album\n" | webfetch batch --jsonl --continue-on-error --candidates 3
```

Input lines are `query` or `query<TAB>provider-a,provider-b`; blank lines and
lines beginning with `#` are ignored. Each `--jsonl` output line is one record:

```json
{"index":0,"query":"drake portrait","status":"ok","candidateCount":12,"candidates":[],"top":null,"downloads":[],"providerReports":[],"warnings":[]}
```

`status` is `ok` or `error`. With `--download-best`, `downloads[0]` contains
`url`, `path`, `sha256`, and optional `sidecar`.

For hosted API mode:

```bash
webfetch config set apiKey wf_live_...
webfetch search "drake portrait" --cloud --json
```

Without `--cloud`, the CLI runs local `webfetch-core` and reads provider keys
from the process environment. Cloud mode calls `https://api.getwebfetch.com/v1/*`
unless `WEBFETCH_BASE_URL` or config `baseUrl` overrides it.

## 2. MCP server (Claude Code / Cursor / Cline / Continue / Roo Code)

1. Use the npx configs at the top of this page, OR copy the matching snippet from
   [`integrations/`](../integrations/) into your agent's MCP config.
2. Restart the agent.
3. Verify: ask the agent to call `search_images` for a simple query, or run
   `webfetch providers` locally. The registry has 25 providers and 19 defaults.

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

The browser package lives at `packages/browser/` in the repo and is loaded as an
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
