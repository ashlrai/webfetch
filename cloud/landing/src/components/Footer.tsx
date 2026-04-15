import Link from "next/link";

export function Footer() {
  return (
    <footer className="wf-scanlines border-t border-[var(--color-border)] mt-24 bg-[var(--color-bg)]">
      <div className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-5 gap-10 text-sm">
        <div className="col-span-2">
          <div className="flex items-center gap-2 font-mono font-semibold text-[var(--color-fg)]">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--color-accent)]" />
            webfetch
          </div>
          <p className="mt-3 text-[var(--color-fg-dim)] max-w-xs leading-relaxed">
            The license-first image layer for AI agents and humans.
          </p>

          <form
            action="mailto:hello@getwebfetch.com"
            method="post"
            encType="text/plain"
            className="mt-6 flex items-center gap-2 max-w-sm"
          >
            <input
              type="email"
              name="email"
              required
              placeholder="you@company.com"
              className="flex-1 bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[13px] font-mono text-[var(--color-fg)] placeholder:text-[var(--color-fg-faint)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <button type="submit" className="wf-btn-ghost">
              Subscribe
            </button>
          </form>
          <p className="mt-2 text-[11px] font-mono text-[var(--color-fg-faint)]">
            low-volume · release notes only
          </p>
        </div>

        <FooterCol title="Product">
          <FooterLink href="/pricing">Pricing</FooterLink>
          <FooterLink href="/compare">Compare</FooterLink>
          <FooterLink href="/mcp-registry">MCP registry</FooterLink>
          <FooterLink href="/docs">Docs</FooterLink>
        </FooterCol>

        <FooterCol title="Resources">
          <FooterLink href="/blog">Blog</FooterLink>
          <FooterLink href="https://github.com/ashlrai/web-fetcher-mcp">GitHub</FooterLink>
          <FooterLink href="https://app.getwebfetch.com">Dashboard</FooterLink>
        </FooterCol>

        <FooterCol title="Legal">
          <FooterLink href="/legal/terms">Terms</FooterLink>
          <FooterLink href="/legal/privacy">Privacy</FooterLink>
          <FooterLink href="/legal/license-policy">License policy</FooterLink>
        </FooterCol>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-[11px] font-mono text-[var(--color-fg-dim)] border-t border-[var(--color-border)]">
        <div>© {new Date().getFullYear()} Ashlar AI · MIT licensed core</div>
        <div className="flex gap-4">
          <a href="https://x.com/ashlr_ai">X</a>
          <a href="https://github.com/ashlrai">GitHub</a>
          <span className="text-[var(--color-fg-faint)]">built by Mason Wyatt</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-mono text-[var(--color-fg-faint)] uppercase tracking-[0.15em] mb-3">
        {title}
      </div>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http");
  if (external) {
    return (
      <li>
        <a href={href} className="text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] transition-colors">
          {children}
        </a>
      </li>
    );
  }
  return (
    <li>
      <Link href={href} className="text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] transition-colors">
        {children}
      </Link>
    </li>
  );
}
