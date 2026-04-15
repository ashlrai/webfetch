import { FadeUp } from "./FadeUp";

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
    href: "https://app.getwebfetch.com/signup",
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
    href: "https://app.getwebfetch.com/signup?plan=pro",
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
    href: "https://app.getwebfetch.com/signup?plan=team",
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
    href: "mailto:sales@getwebfetch.com",
  },
];

export function PricingTable() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-6 flex items-center gap-2 text-[12px] font-mono text-[var(--color-fg-dim)]">
        <span className="relative group cursor-help border-b border-dotted border-[var(--color-fg-dim)]">
          What&apos;s a fetch?
          <span className="invisible group-hover:visible absolute left-0 top-full mt-2 w-72 bg-[var(--color-bg-elev-2)] border border-[var(--color-border)] rounded-md p-3 text-[11px] text-[var(--color-fg-muted)] leading-relaxed shadow-xl z-10">
            One <span className="text-[var(--color-accent)]">fetch</span> = one license-resolved image
            (either a successful download or a cached hit). Searches and rejected
            UNKNOWN candidates don&apos;t count.
          </span>
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {TIERS.map((t, i) => (
          <FadeUp key={t.name} delay={i * 60}>
            <div
              className={`wf-card flex flex-col h-full relative ${
                t.highlight
                  ? "border-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent)]"
                  : ""
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-2.5 left-4 bg-[var(--color-accent)] text-[var(--color-bg)] text-[10px] font-mono font-bold tracking-widest uppercase px-2 py-0.5 rounded">
                  popular
                </span>
              )}
              <div className="flex items-baseline justify-between">
                <div className="font-mono text-[18px] font-semibold">{t.name}</div>
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-mono text-[30px] font-semibold tracking-tight">{t.price}</span>
                <span className="text-[12px] font-mono text-[var(--color-fg-dim)]">{t.cadence}</span>
              </div>
              <p className="mt-2 text-[13px] text-[var(--color-fg-dim)] leading-relaxed">{t.blurb}</p>
              <ul className="mt-5 space-y-2 text-[13px] flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-[var(--color-accent)] mt-0.5 font-mono">—</span>
                    <span className="text-[var(--color-fg-muted)]">{f}</span>
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
          </FadeUp>
        ))}
      </div>
    </section>
  );
}
