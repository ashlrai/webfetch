import Link from "next/link";

const NAV_LINKS = [
  { href: "/#features", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/compare", label: "Compare" },
  { href: "/mcp-registry", label: "MCP" },
] as const;

export function Nav(): React.JSX.Element {
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
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-white transition-colors">
              {link.label}
            </Link>
          ))}
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
