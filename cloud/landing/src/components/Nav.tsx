import Link from "next/link";

export function Nav() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(10,10,12,0.72)] border-b border-[var(--color-border)]">
      <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 font-mono font-semibold tracking-tight text-[var(--color-fg)]"
        >
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--color-accent)]" />
          webfetch
        </Link>
        <div className="hidden md:flex items-center gap-7 text-[13px] font-mono text-[var(--color-fg-dim)]">
          <Link href="/#features" className="hover:text-[var(--color-fg)] transition-colors">
            Product
          </Link>
          <Link href="/pricing" className="hover:text-[var(--color-fg)] transition-colors">
            Pricing
          </Link>
          <Link href="/docs" className="hover:text-[var(--color-fg)] transition-colors">
            Docs
          </Link>
          <Link href="/blog" className="hover:text-[var(--color-fg)] transition-colors">
            Blog
          </Link>
          <Link href="/compare" className="hover:text-[var(--color-fg)] transition-colors">
            Compare
          </Link>
          <Link href="/mcp-registry" className="hover:text-[var(--color-fg)] transition-colors">
            MCP
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://app.getwebfetch.com"
            className="hidden sm:inline text-[13px] font-mono text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            Sign in
          </a>
          <a href="https://app.getwebfetch.com/signup" className="wf-btn-primary text-sm">
            Start free
          </a>
        </div>
      </nav>
    </header>
  );
}
