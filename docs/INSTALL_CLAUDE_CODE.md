# Installing into Claude Code

**Easiest path:** use npx. No clone needed:

```bash
claude mcp add --scope user webfetch -- npx -y getwebfetch-mcp
```

To add provider keys, pass `-e`:
`claude mcp add --scope user -e UNSPLASH_ACCESS_KEY=... webfetch -- npx -y getwebfetch-mcp`.

**From a clone:** the one-line installer registers the MCP server from source
in `~/.claude.json`, idempotently:

```bash
curl -fsSL https://raw.githubusercontent.com/ashlrai/webfetch/main/install/install.sh | bash
```

**Manual path:** Claude Code reads user-scoped MCP servers from the top-level
`mcpServers` key in `~/.claude.json`, and project-scoped servers from
`.mcp.json` in the project root. Merge this into one of them:

```json
{
  "mcpServers": {
    "webfetch": {
      "command": "npx",
      "args": ["-y", "getwebfetch-mcp"],
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

> `~/.claude/settings.json` is **not** read for `mcpServers`. Older versions
> of `install.sh` wrote the entry there, where Claude Code silently ignores it.
> Re-run the installer, or use `claude mcp add`.

Restart Claude Code, then run `claude mcp list` or `/mcp`. The `webfetch` tools
(`search_images`, `search_artist_images`, etc.) will appear in the tool list.
