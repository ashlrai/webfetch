import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MCP Registry",
  description: "Machine-readable MCP manifest + copy-paste snippets for every major agent.",
};

const snippets: Record<string, string> = {
  "Claude Code": `{
  "mcpServers": {
    "webfetch": {
      "command": "npx",
      "args": ["-y", "@webfetch/mcp"],
      "env": { "WEBFETCH_API_KEY": "wf_live_..." }
    }
  }
}`,
  Cursor: `{
  "mcpServers": {
    "webfetch": {
      "command": "npx",
      "args": ["-y", "@webfetch/mcp"]
    }
  }
}`,
  Cline: `// cline_mcp_settings.json
{
  "mcpServers": {
    "webfetch": { "command": "npx", "args": ["-y", "@webfetch/mcp"] }
  }
}`,
  Continue: `mcpServers:
  - name: webfetch
    command: npx
    args: ["-y", "@webfetch/mcp"]`,
  "Roo Code": `{
  "mcpServers": {
    "webfetch": { "command": "npx", "args": ["-y", "@webfetch/mcp"] }
  }
}`,
  Codex: `# ~/.codex/config.toml
[[mcp_servers]]
name = "webfetch"
command = "npx"
args = ["-y", "@webfetch/mcp"]`,
};

export default function McpRegistryPage() {
  return (
    <section className="max-w-4xl mx-auto px-6 py-20">
      <h1 className="text-4xl font-semibold tracking-tight">MCP registry</h1>
      <p className="mt-3 text-[var(--fg-dim)] max-w-2xl">
        webfetch exposes a Model Context Protocol server with three tools:{" "}
        <code className="font-mono">search_images</code>,{" "}
        <code className="font-mono">search_artist_images</code>, and{" "}
        <code className="font-mono">download_image</code>. Machine manifest below; copy-paste
        snippets for every major agent follow.
      </p>

      <h2 className="mt-12 text-2xl font-semibold">Manifest</h2>
      <p className="mt-2 text-sm text-[var(--fg-dim)]">
        Served at{" "}
        <a href="/mcp/manifest.json" className="text-[var(--accent)] font-mono">
          /mcp/manifest.json
        </a>
        .
      </p>
      <pre className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--code-bg)] p-4 overflow-x-auto text-sm font-mono">
{`{
  "name": "webfetch",
  "version": "1.0.0",
  "description": "License-first federated image search MCP server",
  "transport": "stdio",
  "command": "npx -y @webfetch/mcp",
  "tools": [
    { "name": "search_images", "description": "Search 19+ providers, license-ranked" },
    { "name": "search_artist_images", "description": "Musician-optimized search" },
    { "name": "download_image", "description": "Content-addressed download with attribution" }
  ],
  "auth": {
    "type": "bearer",
    "env": "WEBFETCH_API_KEY",
    "optional": true
  }
}`}
      </pre>

      <h2 className="mt-12 text-2xl font-semibold">Install snippets</h2>
      <div className="mt-6 space-y-6">
        {Object.entries(snippets).map(([agent, snippet]) => (
          <div key={agent}>
            <div className="text-sm font-mono text-[var(--accent)] mb-2">{agent}</div>
            <pre className="rounded-lg border border-[var(--border)] bg-[var(--code-bg)] p-4 overflow-x-auto text-sm font-mono">
              {snippet}
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}
