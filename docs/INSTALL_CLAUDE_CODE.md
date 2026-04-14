# Installing into Claude Code

**Easiest path:** run the one-line installer, which merges this block for
you idempotently:

```bash
curl -fsSL https://raw.githubusercontent.com/ashlr-ai/web-fetcher-mcp/main/install/install.sh | bash
```

**Manual path:** add this block to `~/.claude/settings.json` (replace the
repo path with your clone — the installer uses `~/.webfetch/repo`):

```json
{
  "mcpServers": {
    "webfetch": {
      "command": "bun",
      "args": ["run", "/REPLACE_WITH_REPO_PATH/packages/mcp/src/index.ts"]
    }
  }
}
```

Optionally set provider auth via env:

```json
{
  "mcpServers": {
    "webfetch": {
      "command": "bun",
      "args": ["run", "/REPLACE_WITH_REPO_PATH/packages/mcp/src/index.ts"],
      "env": {
        "UNSPLASH_ACCESS_KEY": "...",
        "PEXELS_API_KEY": "...",
        "PIXABAY_API_KEY": "...",
        "BRAVE_API_KEY": "...",
        "SPOTIFY_CLIENT_ID": "...",
        "SPOTIFY_CLIENT_SECRET": "...",
        "SERPAPI_KEY": "..."
      }
    }
  }
}
```

Restart Claude Code. The `webfetch` tools (`search_images`, `search_artist_images`,
etc.) will appear in the tool list.
