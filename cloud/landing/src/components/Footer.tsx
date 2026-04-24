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
          <p className="mt-2 text-[11px] font-mono text-[var(--color-fg-faint)]">
            an{" "}
            <a
              href="https://ashlr.ai"
              className="text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              AshlrAI
            </a>{" "}
            product
          </p>

          <form
            action="mailto:waitlist@getwebfetch.com"
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
          <FooterLink href="/docs">Docs</FooterLink>
          <FooterLink href="/mcp-registry">MCP registry</FooterLink>
          <FooterLink href="/compare">Compare</FooterLink>
          <FooterLink href="/blog">Changelog</FooterLink>
        </FooterCol>

        <FooterCol title="Resources">
          <FooterLink href="/blog">Blog</FooterLink>
          <FooterLink href="https://github.com/ashlrai/web-fetcher-mcp/tree/main/docs/COOKBOOK.md">
            Cookbook
          </FooterLink>
          <FooterLink href="https://github.com/ashlrai/web-fetcher-mcp/blob/main/docs/API.md">
            API reference
          </FooterLink>
          <FooterLink href="https://github.com/ashlrai/web-fetcher-mcp/blob/main/docs/SELF_HOSTING.md">
            Self-hosting
          </FooterLink>
        </FooterCol>

        <FooterCol title="Company">
          <FooterLink href="/about">About</FooterLink>
          <FooterLink href="https://ashlr.ai">AshlrAI</FooterLink>
          <FooterLink href="https://github.com/ashlrai/phantom-secrets">phantom-secrets</FooterLink>
          <FooterLink href="https://github.com/ashlrai/ashlrcode">ashlrcode</FooterLink>
          <FooterLink href="mailto:hello@ashlr.ai">Contact</FooterLink>
        </FooterCol>

        <FooterCol title="Legal">
          <FooterLink href="/legal/terms">Terms</FooterLink>
          <FooterLink href="/legal/privacy">Privacy</FooterLink>
          <FooterLink href="/legal/license-policy">License policy</FooterLink>
          <FooterLink href="https://github.com/ashlrai/web-fetcher-mcp/blob/main/SECURITY.md">
            Security
          </FooterLink>
        </FooterCol>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[11px] font-mono text-[var(--color-fg-dim)] border-t border-[var(--color-border)]">
        <div className="font-mono">
          © {new Date().getFullYear()} AshlrAI · Built with attribution by Mason Wyatt.
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://x.com/ashlr_ai"
            aria-label="X (Twitter)"
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M18.244 2H21l-6.54 7.47L22 22h-6.77l-4.76-6.23L4.8 22H2l7.01-8.01L2 2h6.93l4.3 5.68L18.24 2zm-2.37 18h1.68L8.2 4h-1.8l9.47 16z" />
            </svg>
          </a>
          <a
            href="https://github.com/ashlrai"
            aria-label="GitHub"
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.94c.58.1.79-.25.79-.55v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.08-.12-.3-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.75.12 3.05.73.8 1.18 1.82 1.18 3.08 0 4.41-2.7 5.38-5.26 5.66.41.36.78 1.05.78 2.13v3.16c0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" />
            </svg>
          </a>
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
  const external = href.startsWith("http") || href.startsWith("mailto:");
  if (external) {
    return (
      <li>
        <a
          href={href}
          className="text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] transition-colors"
        >
          {children}
        </a>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={href}
        className="text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] transition-colors"
      >
        {children}
      </Link>
    </li>
  );
}
