const QA = [
  {
    q: "What counts as a fetch?",
    a: "A fetch is one successful /search, /download, or /probe call on the cloud API. Local usage against self-hosted CLI/MCP is unlimited and never counted. Cached hits (SHA-256 cache) are free.",
  },
  {
    q: "Is this commercial safe?",
    a: "Yes, when you stay on the default license policy (safe-only). Results are ranked CC0 > PUBLIC_DOMAIN > CC_BY > CC_BY_SA > EDITORIAL_LICENSED, and UNKNOWN is rejected. Attribution strings are pre-built so you can ship directly. Browser-sourced images always get a sidecar and require opt-in.",
  },
  {
    q: "Can I self-host?",
    a: "Yes. The CLI, MCP server, HTTP server, and core library are MIT-licensed. The cloud (metering, dashboard, managed browser) is the paid layer. Enterprise can run a dedicated tenant or on-prem Node + SQLite build.",
  },
  {
    q: "What if I need a custom provider?",
    a: "Pro+ ships a provider plugin surface. Enterprise gets custom provider adapters built for you. The adapter interface is ~50 lines of TypeScript — fetch + map to the canonical candidate shape.",
  },
  {
    q: "How is this different from Unsplash or Google Images?",
    a: "Unsplash is one source under one license. Google Images has no usable API and zero license metadata. webfetch federates 19+ licensed sources, ranks them license-first, and falls through to a human-like browser only when you opt in — with attribution sidecars on everything it returns.",
  },
  {
    q: "What about copyright on browser-sourced images?",
    a: "Browser-sourced images come back with license: UNKNOWN by default and require an explicit opt-in per call. Every one ships with a sidecar JSON containing source URL, screenshot thumbnail, and extracted metadata. You own the compliance decision; we make it easy to record and audit.",
  },
];

export function FAQ() {
  return (
    <section className="max-w-3xl mx-auto px-6 py-20">
      <h2 className="text-3xl font-semibold tracking-tight mb-8">FAQ</h2>
      <div className="divide-y divide-[var(--border)]">
        {QA.map((item) => (
          <details key={item.q} className="group py-5">
            <summary className="cursor-pointer font-medium flex items-center justify-between list-none">
              <span>{item.q}</span>
              <span className="text-[var(--fg-dim)] group-open:text-[var(--accent)] transition-colors">
                +
              </span>
            </summary>
            <p className="mt-3 text-[var(--fg-dim)] leading-relaxed">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
