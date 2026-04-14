import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] mt-24">
      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-5 gap-8 text-sm">
        <div className="col-span-2">
          <div className="flex items-center gap-2 font-semibold">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--accent)]" />
            webfetch
          </div>
          <p className="mt-3 text-[var(--fg-dim)] max-w-xs">
            The license-first image layer for AI agents and humans.
          </p>
        </div>
        <div>
          <div className="text-[var(--fg-dim)] mb-3">Product</div>
          <ul className="space-y-2">
            <li><Link href="/pricing">Pricing</Link></li>
            <li><Link href="/compare">Compare</Link></li>
            <li><Link href="/mcp-registry">MCP registry</Link></li>
            <li><Link href="/docs">Docs</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-[var(--fg-dim)] mb-3">Resources</div>
          <ul className="space-y-2">
            <li><Link href="/blog">Blog</Link></li>
            <li><a href="https://github.com/ashlr-ai/web-fetcher-mcp">GitHub</a></li>
            <li><a href="https://app.webfetch.dev">Dashboard</a></li>
          </ul>
        </div>
        <div>
          <div className="text-[var(--fg-dim)] mb-3">Legal</div>
          <ul className="space-y-2">
            <li><Link href="/legal/terms">Terms</Link></li>
            <li><Link href="/legal/privacy">Privacy</Link></li>
            <li><Link href="/legal/license-policy">License policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-[var(--fg-dim)] border-t border-[var(--border)]">
        <div>(c) {new Date().getFullYear()} Ashlar AI. All rights reserved.</div>
        <div className="flex gap-4">
          <a href="https://x.com/ashlr_ai">X</a>
          <a href="https://github.com/ashlr-ai">GitHub</a>
          <span>Built by Mason Wyatt</span>
        </div>
      </div>
    </footer>
  );
}
