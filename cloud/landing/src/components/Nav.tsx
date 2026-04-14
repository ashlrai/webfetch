import Link from "next/link";

export function Nav() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(10,10,12,0.7)] border-b border-[var(--border)]">
      <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--accent)]" />
          webfetch
        </Link>
        <div className="hidden md:flex items-center gap-6 text-sm text-[var(--fg-dim)]">
          <Link href="/#features">Product</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/mcp-registry">MCP</Link>
        </div>
        <div className="flex items-center gap-3">
          <a href="https://app.webfetch.dev" className="text-sm text-[var(--fg-dim)] hover:text-[var(--fg)]">
            Sign in
          </a>
          <a href="https://app.webfetch.dev/signup" className="wf-btn-primary text-sm">
            Start free
          </a>
        </div>
      </nav>
    </header>
  );
}
