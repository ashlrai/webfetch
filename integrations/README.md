# Integrations

Pre-baked configs for every MCP-speaking IDE / agent.

| Tool         | Config file                                | Notes                                                     |
| ------------ | ------------------------------------------ | --------------------------------------------------------- |
| Claude Code  | `claude-code/settings.snippet.json`        | The installer wires this up automatically.                |
| Cursor       | `cursor/mcp.json`                          | Drop into `~/.cursor/mcp.json`.                           |
| Cline        | `cline/cline_mcp_settings.json`            | VS Code globalStorage path; includes safe `autoApprove`.  |
| Continue     | `continue/config.json`                     | Under `experimental.modelContextProtocolServers`.         |
| Roo Code     | `roo-code/mcp.json`                        | Mirrors Cline's shape with `alwaysAllow`.                 |
| Codex        | `codex/AGENTS.md`                          | Project-level `AGENTS.md` rules for CLI-based agents.     |
| GitHub Action| `github-action/action.yml`                 | Build-time image enrichment in CI.                        |

## Recommended starting point

- **If you use Claude Code:** run `install/install.sh` — it's the fastest path.
- **If you use Cursor or Cline:** run the installer (for the CLI), then copy
  the relevant snippet from this directory.
- **If you're shipping content from GitHub Actions:** use the composite
  action in `github-action/` — no local install needed.

Every config above refers to the same MCP server entry point
(`packages/mcp/src/index.ts`) and shares the same on-disk cache at
`~/.webfetch/cache/`, so moving between tools is stateless.

## Replacing `REPLACE_WITH_REPO_PATH`

The snippets contain `REPLACE_WITH_REPO_PATH` as a placeholder for the
directory you cloned webfetch into. The default installer path is
`~/.webfetch/repo`. If you installed elsewhere, substitute that path.
