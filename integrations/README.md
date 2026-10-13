# Integrations

Pre-baked configs for every MCP-speaking IDE / agent.

| Tool         | Config file                                | Notes                                                     |
| ------------ | ------------------------------------------ | --------------------------------------------------------- |
| Claude Desktop | `claude-desktop/claude_desktop_config.json` | Merge into Claude Desktop's config (see README).       |
| Claude Code  | `claude-code/mcp.json`                     | Or `claude mcp add --scope user webfetch -- npx -y getwebfetch-mcp`. |
| Cursor       | `cursor/mcp.json`                          | Drop into `~/.cursor/mcp.json`.                           |
| Cline        | `cline/cline_mcp_settings.json`            | VS Code globalStorage path; includes safe `autoApprove`.  |
| Continue     | `continue/config.json`                     | Under `experimental.modelContextProtocolServers`.         |
| Roo Code     | `roo-code/mcp.json`                        | Mirrors Cline's shape with `alwaysAllow`.                 |
| Codex        | `codex/AGENTS.md`                          | Project-level `AGENTS.md` rules for CLI-based agents.     |
| GitHub Action| `github-action/action.yml`                 | Build-time image enrichment in CI.                        |

## Recommended starting point

- **Any MCP client:** the snippets launch the published server with
  `npx -y getwebfetch-mcp` (Node 18+). No clone is needed.
- **Claude Code:** `claude mcp add --scope user webfetch -- npx -y getwebfetch-mcp`.
- **If you're shipping content from GitHub Actions:** use the composite
  action in `github-action/`. No local install is needed.

Every snippet starts the same MCP server and uses the same on-disk cache at
`~/.webfetch/cache/`, so switching between tools keeps no separate state.

## Running from a clone instead

Replace `"command": "npx", "args": ["-y", "getwebfetch-mcp"]` with
`"command": "bun", "args": ["run", "<clone>/packages/mcp/src/index.ts"]`.
The installer clones to `~/.webfetch/repo`.

`packages/mcp/test/quickstart.test.ts` checks that every snippet here parses
and launches a real bin.
