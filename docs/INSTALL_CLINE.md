# Installing into Cline

Cline reads MCP config from its settings pane (or
`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
on macOS):

```json
{
  "mcpServers": {
    "webfetch": {
      "command": "bun",
      "args": ["run", "/REPLACE_WITH_REPO_PATH/packages/mcp/src/index.ts"],
      "disabled": false,
      "autoApprove": ["search_images", "search_artist_images", "search_album_cover", "probe_page"]
    }
  }
}
```
