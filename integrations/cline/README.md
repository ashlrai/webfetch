# Cline

On macOS, Cline's MCP settings live at:

```
~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
```

1. Merge `cline_mcp_settings.json` here into that file.
2. It launches `npx -y getwebfetch-mcp`, so no clone is needed.
3. `autoApprove` lists read-only tools that do not write to disk — safe to
   auto-approve. `download_image` is intentionally excluded.
4. Restart VS Code / Cline.
