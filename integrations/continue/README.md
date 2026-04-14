# Continue

Continue's MCP support is under `experimental.modelContextProtocolServers`
in `~/.continue/config.json`.

1. Merge the snippet in `config.json` into `~/.continue/config.json`.
2. Replace `REPLACE_WITH_REPO_PATH` with your clone path.
3. Reload Continue (VS Code / JetBrains).

If you already have other MCP servers listed, append the `webfetch` object to
the existing array rather than overwriting.
