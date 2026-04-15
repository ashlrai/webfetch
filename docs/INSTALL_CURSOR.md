# Installing into Cursor

Run the one-line installer first so the CLI and repo are on disk:

```bash
curl -fsSL https://raw.githubusercontent.com/ashlrai/web-fetcher-mcp/main/install/install.sh | bash --no-claude
```

Then, Cursor loads MCP servers from `~/.cursor/mcp.json`:

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

Reload Cursor. Then in Composer/Chat, tools are available under the
`webfetch` namespace.
