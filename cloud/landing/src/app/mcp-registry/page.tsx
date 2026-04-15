import { CopyButton } from "@/components/CopyButton";
import { FadeUp } from "@/components/FadeUp";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MCP Registry — Install webfetch in any agent",
  description:
    "Copy-paste MCP snippets for Claude Code, Cursor, Cline, Windsurf, and a machine-readable manifest. One-line registration in every major AI coding agent.",
  alternates: { canonical: "/mcp-registry" },
  openGraph: {
    title: "webfetch MCP Registry — one-line install for every agent",
    description:
      "Copy-paste MCP configs for Claude Code, Cursor, Cline, Windsurf, plus a machine-readable manifest.",
    url: "https://getwebfetch.com/mcp-registry",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "webfetch MCP Registry",
    description: "One-line MCP install for Claude Code, Cursor, Cline, Windsurf.",
    images: ["/og-image.png"],
  },
};

const SNIPPETS: Array<{ agent: string; path: string; snippet: string }> = [
  {
    agent: "Claude Code",
    path: "~/.claude/settings.json",
    snippet: `{
  "mcpServers": {
    "webfetch": {
      "command": "npx",
      "args": ["-y", "@webfetch/mcp"],
      "env": { "WEBFETCH_API_KEY": "wf_live_..." }
    }
  }
}`,
  },
  {
    agent: "Cursor",
    path: "~/.cursor/mcp.json",
    snippet: `{
  "mcpServers": {
    "webfetch": {
      "command": "npx",
      "args": ["-y", "@webfetch/mcp"]
    }
  }
}`,
  },
  {
    agent: "Cline",
    path: "cline_mcp_settings.json",
    snippet: `{
  "mcpServers": {
    "webfetch": { "command": "npx", "args": ["-y", "@webfetch/mcp"] }
  }
}`,
  },
  {
    agent: "Continue",
    path: "~/.continue/config.yaml",
    snippet: `mcpServers:
  - name: webfetch
    command: npx
    args: ["-y", "@webfetch/mcp"]`,
  },
  {
    agent: "Roo Code",
    path: "mcp_settings.json",
    snippet: `{
  "mcpServers": {
    "webfetch": { "command": "npx", "args": ["-y", "@webfetch/mcp"] }
  }
}`,
  },
  {
    agent: "Codex",
    path: "~/.codex/config.toml",
    snippet: `[[mcp_servers]]
name = "webfetch"
command = "npx"
args = ["-y", "@webfetch/mcp"]`,
  },
];

const MANIFEST = `{
  "name": "webfetch",
  "version": "1.0.0",
  "description": "License-first federated image search MCP server",
  "transport": "stdio",
  "command": "npx -y @webfetch/mcp",
  "tools": [
    { "name": "search_images", "description": "Search 24 providers, license-ranked" },
    { "name": "search_artist_images", "description": "Musician-optimized search" },
    { "name": "download_image", "description": "Content-addressed download with attribution" }
  ],
  "auth": {
    "type": "bearer",
    "env": "WEBFETCH_API_KEY",
    "optional": true
  }
}`;

export default function McpRegistryPage() {
  return (
    <section className="max-w-5xl mx-auto px-6 py-20">
      <FadeUp>
        <div className="text-[11px] font-mono text-[var(--color-accent)] uppercase tracking-[0.2em] mb-3">
          — mcp registry
        </div>
        <h1 className="font-mono text-[36px] md:text-[48px] font-semibold tracking-[-0.03em] leading-[1.05]">
          One server. Every agent.
        </h1>
        <p className="mt-4 text-[var(--color-fg-dim)] max-w-2xl leading-relaxed">
          webfetch exposes a Model Context Protocol server with three tools:{" "}
          <code className="font-mono text-[var(--color-accent)]">search_images</code>,{" "}
          <code className="font-mono text-[var(--color-accent)]">search_artist_images</code>, and{" "}
          <code className="font-mono text-[var(--color-accent)]">download_image</code>. Machine
          manifest below; copy-paste snippets for every major agent follow.
        </p>
      </FadeUp>

      <FadeUp delay={80}>
        <div className="mt-12">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-mono text-[20px] font-semibold">Manifest</h2>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-[var(--color-fg-dim)]">
                /mcp/manifest.json
              </span>
              <CopyButton text={MANIFEST} />
            </div>
          </div>
          <pre className="rounded-lg border border-[var(--color-border)] bg-[var(--color-code-bg)] p-4 overflow-x-auto text-[12px] font-mono leading-relaxed">
            {MANIFEST}
          </pre>
        </div>
      </FadeUp>

      <FadeUp delay={120}>
        <h2 className="mt-16 font-mono text-[20px] font-semibold">Install snippets</h2>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {SNIPPETS.map((s) => (
            <div
              key={s.agent}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
                <div>
                  <div className="text-[13px] font-mono font-semibold text-[var(--color-fg)]">
                    {s.agent}
                  </div>
                  <div className="text-[10px] font-mono text-[var(--color-fg-faint)]">{s.path}</div>
                </div>
                <CopyButton text={s.snippet} />
              </div>
              <pre className="p-4 overflow-x-auto text-[12px] font-mono leading-relaxed text-[var(--color-fg-muted)]">
                {s.snippet}
              </pre>
            </div>
          ))}
        </div>
      </FadeUp>
    </section>
  );
}
