# Claude Desktop

Merge `claude_desktop_config.json` into:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Claude Desktop → Settings → Developer → Edit Config opens that file. Quit and
reopen Claude Desktop afterward. If you see `spawn npx ENOENT`, replace `"npx"`
with the absolute path printed by `which npx`.
