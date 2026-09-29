# Roo Code

Roo Code reads MCP config from its settings pane (writes to
`mcp_settings.json` under its VS Code globalStorage dir).

1. Open the MCP tab in Roo Code's settings.
2. Paste `mcp.json`'s `mcpServers.webfetch` entry.
3. It launches `npx -y getwebfetch-mcp`, so no clone is needed.
4. `alwaysAllow` lists read-only tools safe to auto-approve.
