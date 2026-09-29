# Recipe: call webfetch from an agent over MCP stdio

Agent frameworks talk to MCP servers with newline-delimited JSON-RPC over the
server's stdin/stdout. [agent.mjs](agent.mjs) does exactly that with no
dependencies, so you can see every step and copy it into any pipeline:

1. spawn the server (`bun packages/mcp/src/index.ts`, or the published
   `npx -y getwebfetch-mcp`);
2. `initialize`, then the `notifications/initialized` notification;
3. `tools/list` to discover `search_images` and the other tools;
4. `tools/call search_images` with `licensePolicy: "open-only"`;
5. read `structuredContent.results` (URL, license, attribution line) and pass
   it to the next step. Here it goes to stdout as JSON.

## Run

```bash
# This checkout's server (after bun install)
node examples/mcp-stdio-agent/agent.mjs "red panda"

# The published server. Run it from outside this repo: inside the workspace,
# npx resolves the local unbuilt getwebfetch-mcp package instead.
cd /tmp && node /path/to/webfetch/examples/mcp-stdio-agent/agent.mjs "red panda" --server "npx -y getwebfetch-mcp"
```

Flags: `--server "<command>"`, `--providers wikimedia,openverse,nasa`,
`--license open-only|safe-only|prefer-safe|any`.

Trimmed output from a real run (Sep 29, 2026):

```json
{
  "server": { "name": "webfetch", "version": "0.1.5" },
  "toolCount": 22,
  "images": [
    {
      "url": "https://live.staticflickr.com/329/19244498670_29a1191b44_b.jpg",
      "license": "CC_BY",
      "attribution": "\"Red Panda @ Singapore River Safari\" by Juliana Chong (Openverse), licensed CC BY 4.0 — https://www.flickr.com/photos/109731265@N05/19244498670"
    }
  ]
}
```

`toolCount` is 22 for this checkout's server. The published
`getwebfetch-mcp@0.1.5` exposes 7.

## Test

```bash
bun test examples/mcp-stdio-agent
```

The test spawns the real server from this checkout and passes
`providers: []`, so the handshake and tool calls are real but no provider is
contacted.
