import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About · Built by AshlrAI",
  description:
    "webfetch is built by AshlrAI, a small studio from Mason Wyatt building developer infrastructure for the AI agent era. Meet the portfolio.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About webfetch · Built by AshlrAI",
    description:
      "A small studio building developer infrastructure for the AI agent era. webfetch, phantom-secrets, ashlrcode.",
    url: "https://getwebfetch.com/about",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "About webfetch · Built by AshlrAI",
    description: "A small studio building developer infrastructure for the AI agent era.",
    images: ["/og-image.png"],
  },
};

const BREADCRUMB_JSONLD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://getwebfetch.com/" },
    { "@type": "ListItem", position: 2, name: "About", item: "https://getwebfetch.com/about" },
  ],
};

export default function AboutPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB_JSONLD) }}
      />

      <section className="max-w-3xl mx-auto px-6 pt-20 pb-12">
        <div className="text-[11px] font-mono text-[var(--color-fg-faint)] uppercase tracking-[0.18em]">
          About
        </div>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight">Built by AshlrAI.</h1>
        <p className="mt-5 text-lg text-[var(--color-fg-dim)] leading-relaxed">
          webfetch is one product inside{" "}
          <a
            href="https://ashlr.ai"
            className="text-[var(--color-fg)] underline decoration-[var(--color-accent)] underline-offset-4"
          >
            AshlrAI
          </a>
          , a small studio founded by Mason Wyatt that builds developer infrastructure for the AI
          agent era. We ship small, opinionated tools that solve real problems we hit while building
          agent-native software — and we keep them sharp.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-10 border-t border-[var(--color-border)]">
        <div className="text-[11px] font-mono text-[var(--color-fg-faint)] uppercase tracking-[0.18em]">
          Founder
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">Mason Wyatt</h2>
        <p className="mt-4 text-[var(--color-fg-dim)] leading-relaxed">
          Mason is an engineer working on agent-native developer infra. AshlrAI started as a studio
          to factor out the reusable layers that kept showing up across his projects: licensed
          content sourcing, secrets handling for agents, and a coding CLI that could fluidly swap
          model providers. Each one became its own product.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-12 border-t border-[var(--color-border)]">
        <div className="text-[11px] font-mono text-[var(--color-fg-faint)] uppercase tracking-[0.18em]">
          Portfolio
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">What AshlrAI ships</h2>
        <div className="mt-8 grid md:grid-cols-3 gap-5">
          <ProductCard
            name="webfetch"
            status="live"
            tagline="License-first image layer"
            body="One API, CLI, and MCP federating 24 licensed image providers with attribution baked in and a browser fallback when APIs miss."
            href="/"
            highlight
          />
          <ProductCard
            name="phantom-secrets"
            status="beta"
            tagline="E2E-encrypted secrets for AI agents"
            body="A secrets manager that keeps API keys out of agent context windows. End-to-end encrypted, local-first, with optional cloud sync."
            href="https://github.com/ashlrai/phantom-secrets"
          />
          <ProductCard
            name="ashlrcode"
            status="alpha"
            tagline="Multi-provider AI coding CLI"
            body="A terminal coding agent that speaks to Anthropic, OpenAI, and local models through one interface. Bring your own keys."
            href="https://github.com/ashlrai/ashlrcode"
          />
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-12 border-t border-[var(--color-border)]">
        <div className="text-[11px] font-mono text-[var(--color-fg-faint)] uppercase tracking-[0.18em]">
          Origin
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">Why webfetch?</h2>
        <div className="mt-5 space-y-4 text-[var(--color-fg-dim)] leading-relaxed">
          <p>
            webfetch was born inside another AshlrAI project — an artist encyclopedia factory that
            needed licensed, attributed images for thousands of musicians. Every commercial image
            API we tried solved one narrow slice: Unsplash had aesthetics but not artists, Google
            Images had reach but no license signal, Wikimedia had provenance but patchy coverage.
          </p>
          <p>
            Stitching them together became a real system: a federated router, a license ranker, a
            confidence score, attribution normalization, and a human-like browser fallback for the
            long tail. When we realized other teams were rebuilding the same plumbing for their own
            agents, we factored it out.
          </p>
          <p>
            That&apos;s webfetch. License-first, attribution-always, agent-ready by default.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-12 border-t border-[var(--color-border)]">
        <div className="text-[11px] font-mono text-[var(--color-fg-faint)] uppercase tracking-[0.18em]">
          Contact
        </div>
        <div className="mt-4 grid sm:grid-cols-2 gap-6 text-sm font-mono">
          <div>
            <div className="text-[var(--color-fg-faint)]">General</div>
            <a
              href="mailto:hello@ashlr.ai"
              className="text-[var(--color-fg)] hover:text-[var(--color-accent)]"
            >
              hello@ashlr.ai
            </a>
          </div>
          <div>
            <div className="text-[var(--color-fg-faint)]">Press kit</div>
            <Link
              href="/press"
              className="text-[var(--color-fg)] hover:text-[var(--color-accent)]"
            >
              /press <span className="text-[var(--color-fg-faint)]">(coming soon)</span>
            </Link>
          </div>
          <div>
            <div className="text-[var(--color-fg-faint)]">GitHub</div>
            <a
              href="https://github.com/ashlrai"
              className="text-[var(--color-fg)] hover:text-[var(--color-accent)]"
            >
              github.com/ashlrai
            </a>
          </div>
          <div>
            <div className="text-[var(--color-fg-faint)]">X</div>
            <a
              href="https://x.com/ashlr_ai"
              className="text-[var(--color-fg)] hover:text-[var(--color-accent)]"
            >
              @ashlr_ai
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function ProductCard({
  name,
  status,
  tagline,
  body,
  href,
  highlight,
}: {
  name: string;
  status: string;
  tagline: string;
  body: string;
  href: string;
  highlight?: boolean;
}) {
  const external = href.startsWith("http");
  const Inner = (
    <div
      className={`h-full rounded-lg border p-5 transition-colors ${
        highlight
          ? "border-[var(--color-accent)]/40 bg-[var(--color-bg-elev)]"
          : "border-[var(--color-border)] hover:border-[var(--color-fg-muted)]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="font-mono font-semibold text-[var(--color-fg)]">{name}</div>
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--color-fg-faint)]">
          {status}
        </span>
      </div>
      <div className="mt-2 text-[13px] text-[var(--color-fg-muted)]">{tagline}</div>
      <p className="mt-3 text-sm text-[var(--color-fg-dim)] leading-relaxed">{body}</p>
    </div>
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full">
      {Inner}
    </a>
  ) : (
    <Link href={href} className="block h-full">
      {Inner}
    </Link>
  );
}
