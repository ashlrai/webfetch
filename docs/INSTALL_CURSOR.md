# Installing into Cursor

Cursor loads MCP servers from `~/.cursor/mcp.json` (global) or
`.cursor/mcp.json` (per project). No clone needed:

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

Reload Cursor and check Settings → MCP for a green dot next to `webfetch`.
The tools are then available in Composer/Chat.

To run from a clone instead, use `"command": "bun"` and
`"args": ["run", "<clone>/packages/mcp/src/index.ts"]`. The installer clones
to `~/.webfetch/repo`.
