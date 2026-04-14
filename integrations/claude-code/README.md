# Claude Code

1. Run `install/install.sh` — it will merge the `webfetch` MCP entry into
   `~/.claude/settings.json` automatically and idempotently.
2. Or copy `settings.snippet.json` by hand into `~/.claude/settings.json`,
   replacing `REPLACE_WITH_REPO_PATH` with your clone (the installer uses
   `~/.webfetch/repo`).
3. Restart Claude Code.

Verify:

```
In Claude Code, run "/mcp list" or ask the agent to call `search_images`.
```
