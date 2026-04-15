import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs",
  description: "webfetch installation, provider tuning, license policy, cost model.",
};

const DOC_LINKS = [
  {
    title: "Quickstart",
    href: "https://github.com/ashlrai/web-fetcher-mcp/blob/main/docs/QUICKSTART.md",
    blurb:
      "Four install paths: curl one-liner, CLI, MCP, HTTP server, Chrome extension, GitHub Action.",
  },
  {
    title: "Providers",
    href: "https://github.com/ashlrai/web-fetcher-mcp/blob/main/docs/PROVIDERS.md",
    blurb: "Every provider, its auth, rate limits, gotchas, and default license class.",
  },
  {
    title: "Provider tuning",
    href: "https://github.com/ashlrai/web-fetcher-mcp/blob/main/docs/PROVIDER_TUNING.md",
    blurb:
      "Per-use-case picks: musician portrait, album art, historical event, product shot, stock hero.",
  },
  {
    title: "License policy",
    href: "/legal/license-policy",
    blurb: "Ranking table, why UNKNOWN is rejected, attribution format, confidence score rubric.",
  },
  {
    title: "Cost model",
    href: "https://github.com/ashlrai/web-fetcher-mcp/blob/main/docs/COST.md",
    blurb: "Per-fetch unit economics, cache hit rates, pooled vs BYOK provider keys.",
  },
  {
    title: "Install: Claude Code",
    href: "https://github.com/ashlrai/web-fetcher-mcp/blob/main/docs/INSTALL_CLAUDE_CODE.md",
    blurb: "One-line MCP registration for Claude Code.",
  },
  {
    title: "Install: Cursor",
    href: "https://github.com/ashlrai/web-fetcher-mcp/blob/main/docs/INSTALL_CURSOR.md",
    blurb: "One-line MCP registration for Cursor.",
  },
  {
    title: "Install: Cline",
    href: "https://github.com/ashlrai/web-fetcher-mcp/blob/main/docs/INSTALL_CLINE.md",
    blurb: "One-line MCP registration for Cline.",
  },
  {
    title: "MCP registry",
    href: "/mcp-registry",
    blurb: "Machine manifest + copy-paste snippets for every major agent.",
  },
];

export default function DocsIndex() {
  return (
    <section className="max-w-4xl mx-auto px-6 py-20">
      <h1 className="text-4xl font-semibold tracking-tight">Docs</h1>
      <p className="mt-3 text-[var(--fg-dim)] max-w-2xl">
        Installation guides, provider reference, license policy, and the cost model. Canonical
        source of the repo docs; product docs live here.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {DOC_LINKS.map((d) => (
          <Link key={d.title} href={d.href} className="wf-card block">
            <div className="font-semibold">{d.title}</div>
            <p className="mt-2 text-sm text-[var(--fg-dim)] leading-relaxed">{d.blurb}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
