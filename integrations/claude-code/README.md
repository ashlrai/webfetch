# Claude Code

Claude Code reads MCP servers from `~/.claude.json` (user/local scope) or
`.mcp.json` in a project root. It ignores `mcpServers` in `~/.claude/settings.json`.

1. Easiest: `claude mcp add --scope user webfetch -- npx -y getwebfetch-mcp`
2. Or run `install/install.sh`. It registers the from-source server in
   `~/.claude.json`, idempotently.
3. Or merge `mcp.json` by hand into `~/.claude.json` or a project `.mcp.json`.
   Fill in only the provider keys you have. Empty keys are skipped.

Verify with `claude mcp list` or `/mcp` inside Claude Code, or ask the agent to
call `search_images`.
