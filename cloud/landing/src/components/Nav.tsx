import Link from "next/link";

export function Nav() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-[rgba(36,36,44,0.82)] border-b border-[rgba(255,255,255,0.08)] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
      <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 font-mono font-semibold tracking-tight text-white"
        >
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--color-accent)] shadow-[0_0_12px_rgba(255,90,31,0.55)]" />
          webfetch
        </Link>
        <div className="hidden md:flex items-center gap-7 text-[13px] font-mono text-white/85">
          <Link href="/#features" className="hover:text-white transition-colors">
            Product
          </Link>
          <Link href="/pricing" className="hover:text-white transition-colors">
            Pricing
          </Link>
          <Link href="/docs" className="hover:text-white transition-colors">
            Docs
          </Link>
          <Link href="/blog" className="hover:text-white transition-colors">
            Blog
          </Link>
          <Link href="/compare" className="hover:text-white transition-colors">
            Compare
          </Link>
          <Link href="/mcp-registry" className="hover:text-white transition-colors">
            MCP
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://app.getwebfetch.com"
            className="hidden sm:inline text-[13px] font-mono text-white/85 hover:text-white transition-colors"
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
