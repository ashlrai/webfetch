export function ArchitectureDiagram() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <h2 className="text-3xl font-semibold tracking-tight mb-3">How it works</h2>
      <p className="text-[var(--fg-dim)] max-w-2xl mb-8">
        Every surface shares one core. Every core shares one cache. The cloud tier adds metering,
        pooled keys, and a managed browser you never have to operate.
      </p>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-6 md:p-10">
        <svg viewBox="0 0 800 420" className="w-full h-auto" role="img" aria-label="webfetch architecture">
          <defs>
            <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff7a3d" />
              <stop offset="100%" stopColor="#5b8cff" />
            </linearGradient>
          </defs>
          <style>{`
            .node { fill: #0f0f13; stroke: #2a2a33; stroke-width: 1.2; }
            .node-core { fill: #16161c; stroke: url(#accent); stroke-width: 1.5; }
            .label { fill: #ededf0; font: 500 13px ui-sans-serif, system-ui; }
            .sub { fill: #a1a1aa; font: 400 11px ui-monospace, Menlo; }
            .wire { stroke: #2a2a33; stroke-width: 1.2; fill: none; }
          `}</style>

          {[
            { x: 20, y: 20, label: "CLI" },
            { x: 150, y: 20, label: "MCP" },
            { x: 280, y: 20, label: "HTTP server" },
            { x: 420, y: 20, label: "Chrome ext" },
            { x: 560, y: 20, label: "VS Code" },
            { x: 690, y: 20, label: "Python SDK" },
          ].map((n) => (
            <g key={n.label}>
              <rect x={n.x} y={n.y} width={110} height={46} rx={8} className="node" />
              <text x={n.x + 55} y={n.y + 28} textAnchor="middle" className="label">
                {n.label}
              </text>
            </g>
          ))}

          <path d="M 400 66 L 400 120" className="wire" />
          <rect x="270" y="120" width="260" height="60" rx={10} className="node-core" />
          <text x="400" y="148" textAnchor="middle" className="label">@webfetch/core</text>
          <text x="400" y="166" textAnchor="middle" className="sub">
            federation - license - dedupe - pHash
          </text>

          <path d="M 400 180 L 400 215 M 150 215 L 650 215" className="wire" />
          <path d="M 150 215 L 150 245 M 400 215 L 400 245 M 650 215 L 650 245" className="wire" />

          {[
            { x: 40, y: 245, label: "19 providers", sub: "wikimedia - openverse - unsplash - nasa..." },
            { x: 290, y: 245, label: "browser layer", sub: "Rebrowser - Camoufox - Bright Data" },
            { x: 540, y: 245, label: "cloud router", sub: "auth - quota - metering - cache" },
          ].map((n) => (
            <g key={n.label}>
              <rect x={n.x} y={n.y} width={220} height={60} rx={10} className="node" />
              <text x={n.x + 110} y={n.y + 26} textAnchor="middle" className="label">
                {n.label}
              </text>
              <text x={n.x + 110} y={n.y + 44} textAnchor="middle" className="sub">
                {n.sub}
              </text>
            </g>
          ))}

          <path d="M 150 305 L 150 345 M 400 305 L 400 345 M 650 305 L 650 345" className="wire" />
          <rect x="270" y="345" width="260" height="48" rx={10} className="node" />
          <text x="400" y="374" textAnchor="middle" className="label">api.webfetch.dev</text>
        </svg>
      </div>
    </section>
  );
}
