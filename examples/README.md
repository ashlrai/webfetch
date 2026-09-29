# Examples

Runnable recipes for using webfetch inside agent pipelines. Each one has a
hermetic test that runs in CI with `bun test` (no network, no API keys).

| Recipe | What it shows | Run it |
|---|---|---|
| [agent-pipeline](agent-pipeline/) | Library use: illustrate a document. For each topic, find an open-licensed image, download it, and write `CREDITS.md` + `manifest.json` for the writing agent to cite. | `bun examples/agent-pipeline/illustrate.ts "red panda" --out ./illustrations` |
| [mcp-stdio-agent](mcp-stdio-agent/) | Protocol use: a zero-dependency MCP client that spawns the webfetch MCP server over stdio, discovers tools, and calls `search_images` the way an agent framework does. | `node examples/mcp-stdio-agent/agent.mjs "red panda"` |

Setup, once, from the repo root:

```bash
bun install
bun run --cwd packages/core build
```

Both recipes default to keyless providers (`wikimedia`, `openverse`, `nasa`)
and the `open-only` license policy (CC0, public domain, CC BY, CC BY-SA), so
they work on a fresh machine. Add provider keys from
[docs/PROVIDERS.md](../docs/PROVIDERS.md) to widen the search.

Test them:

```bash
bun test examples
```
