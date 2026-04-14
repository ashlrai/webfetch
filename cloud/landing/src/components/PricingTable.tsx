const TIERS = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    blurb: "OSS unlimited locally + cloud evaluation.",
    features: [
      "Unlimited local CLI / MCP / server / extension",
      "100 cloud fetches/day (public APIs)",
      "BYO provider keys (Unsplash, Pexels, SerpAPI...)",
      "License-first ranker, attribution builder",
      "Community support",
    ],
    cta: "Get started",
    href: "https://app.webfetch.dev/signup",
  },
  {
    name: "Pro",
    price: "$19",
    cadence: "/ mo",
    blurb: "For the power dev shipping real work.",
    highlight: true,
    features: [
      "Everything in Free",
      "10,000 metered fetches / mo included",
      "Managed browser fallback (Google Images, Pinterest)",
      "Pooled provider keys (SerpAPI, Brave, Bing)",
      "Usage dashboard + request history + XMP audit trail",
      "$0.015 per fetch beyond quota",
    ],
    cta: "Start Pro",
    href: "https://app.webfetch.dev/signup?plan=pro",
  },
  {
    name: "Team",
    price: "$79",
    cadence: "/ mo + $12/seat",
    blurb: "The real ARR tier. 5 seats baseline.",
    features: [
      "Everything in Pro for the whole team",
      "50,000 metered fetches / mo pooled",
      "Shared workspace, team history, RBAC",
      "Audit log export (CSV)",
      "Priority rate limits, shared cache, BYOK provider keys",
      "$0.01 per fetch beyond quota",
    ],
    cta: "Start Team",
    href: "https://app.webfetch.dev/signup?plan=team",
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "from $500/mo",
    blurb: "Unlimited, SSO, indemnification, custom providers.",
    features: [
      "Fair-use unlimited fetches",
      "SSO (SAML/OIDC), 1yr audit log retention",
      "Self-hosted or dedicated tenant",
      "Support SLA, custom providers",
      "Private npm mirror",
      "Legal indemnification for browser-sourced images (opt-in)",
    ],
    cta: "Contact sales",
    href: "mailto:sales@webfetch.dev",
  },
];

export function PricingTable() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-12">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={`wf-card flex flex-col ${
              t.highlight ? "border-[var(--accent)] shadow-[0_0_0_1px_rgba(255,122,61,0.3)]" : ""
            }`}
          >
            <div className="flex items-baseline justify-between">
              <div className="text-xl font-semibold">{t.name}</div>
              {t.highlight ? (
                <span className="text-xs font-mono text-[var(--accent)]">popular</span>
              ) : null}
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight">{t.price}</span>
              <span className="text-sm text-[var(--fg-dim)]">{t.cadence}</span>
            </div>
            <p className="mt-2 text-sm text-[var(--fg-dim)]">{t.blurb}</p>
            <ul className="mt-5 space-y-2 text-sm flex-1">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-[var(--accent)] mt-1">—</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <a
              href={t.href}
              className={`mt-6 block text-center ${
                t.highlight ? "wf-btn-primary" : "wf-btn-ghost"
              }`}
            >
              {t.cta}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
