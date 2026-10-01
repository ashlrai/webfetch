# Cursor

Cursor reads MCP servers from `~/.cursor/mcp.json`.

1. Copy `mcp.json` to `~/.cursor/mcp.json` (or merge its `mcpServers.webfetch`
   entry into the existing file).
2. It runs the published server with `npx -y getwebfetch-mcp`, so no clone is
   needed.
3. Fill in any provider env vars you want enabled. Missing keys cause the
   matching provider to skip gracefully.
4. Reload Cursor. The `webfetch` tools appear in Composer/Chat.
