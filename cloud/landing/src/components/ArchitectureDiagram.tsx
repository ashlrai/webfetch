import { FadeUp } from "./FadeUp";

export function ArchitectureDiagram() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 md:py-24">
      <FadeUp>
        <div className="text-[11px] font-mono text-[var(--color-accent)] uppercase tracking-[0.2em] mb-3">
          — architecture
        </div>
        <h2 className="font-mono text-[30px] md:text-[36px] font-semibold tracking-[-0.025em] leading-[1.1] max-w-3xl">
          One core. One cache. Every surface.
        </h2>
        <p className="mt-4 text-[var(--color-fg-dim)] max-w-2xl leading-relaxed">
          Every surface shares{" "}
          <code className="font-mono text-[var(--color-accent)]">@webfetch/core</code>. The cloud
          router adds metering, pooled keys, and a managed browser you never have to operate.
        </p>
      </FadeUp>

      <FadeUp delay={80}>
        <div className="mt-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 md:p-8">
          <svg
            viewBox="0 0 880 500"
            className="w-full h-auto"
            role="img"
            aria-label="webfetch architecture: surfaces on top, @webfetch/core + browser + cloud in the middle, 24 providers at the bottom"
          >
            <defs>
              <marker
                id="arr"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M 0 0 L 8 4 L 0 8 Z" fill="#ff5a1f" />
              </marker>
              <pattern id="dots" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
                <circle cx="0.5" cy="0.5" r="0.5" fill="#2a2a30" />
              </pattern>
            </defs>
            <style>{`
              .n { fill: #0f0f13; stroke: #2a2a30; stroke-width: 1; }
              .n-core { fill: #121216; stroke: #ff5a1f; stroke-width: 1.2; }
              .n-sub { fill: #121216; stroke: #2a2a30; stroke-width: 1; }
              .lbl { fill: #f0f0f2; font: 600 12px var(--font-geist-mono), ui-monospace, Menlo; letter-spacing: -0.01em; }
              .lbl-sm { fill: #f0f0f2; font: 500 10px var(--font-geist-mono), ui-monospace, Menlo; }
              .sub { fill: #8a8a95; font: 400 9px var(--font-geist-mono), ui-monospace, Menlo; }
              .sub-core { fill: #c5c5cc; font: 500 10px var(--font-geist-mono), ui-monospace, Menlo; }
              .wire { stroke: #2a2a30; stroke-width: 1; fill: none; }
              .wire-flow { stroke: #ff5a1f; stroke-width: 1.2; fill: none; stroke-opacity: 0.7; }
              .tag { fill: #8a8a95; font: 500 9px var(--font-geist-mono), ui-monospace, Menlo; letter-spacing: 0.1em; text-transform: uppercase; }
            `}</style>

            {/* Row labels */}
            <text x="20" y="32" className="tag">
              surfaces
            </text>
            <text x="20" y="208" className="tag">
              core
            </text>
            <text x="20" y="408" className="tag">
              providers
            </text>

            {/* Surfaces row */}
            {[
              { x: 30, l: "CLI" },
              { x: 170, l: "MCP" },
              { x: 310, l: "HTTP" },
              { x: 450, l: "Chrome ext" },
              { x: 590, l: "VS Code" },
              { x: 730, l: "Python SDK" },
            ].map((n) => (
              <g key={n.l}>
                <rect x={n.x} y={50} width={120} height={44} rx={6} className="n" />
                <text x={n.x + 60} y={77} textAnchor="middle" className="lbl-sm">
                  {n.l}
                </text>
              </g>
            ))}

            {/* wires down to core */}
            {[90, 230, 370, 510, 650, 790].map((x, i) => (
              <path key={i} d={`M ${x} 94 L ${x} 140 L 440 140 L 440 200`} className="wire" />
            ))}

            {/* Core + browser + cloud row */}
            <rect x="140" y="200" width="600" height="70" rx={8} className="n-core" />
            <text x="440" y="226" textAnchor="middle" className="lbl">
              @webfetch/core
            </text>
            <text x="440" y="244" textAnchor="middle" className="sub-core">
              federation · license rank · dedupe · pHash · cache
            </text>
            <text x="440" y="260" textAnchor="middle" className="sub">
              typescript · MIT · 241 tests
            </text>

            {/* branches */}
            <path d="M 240 270 L 240 310" className="wire-flow" markerEnd="url(#arr)" />
            <path d="M 440 270 L 440 310" className="wire-flow" markerEnd="url(#arr)" />
            <path d="M 640 270 L 640 310" className="wire-flow" markerEnd="url(#arr)" />

            {[
              { x: 140, l: "browser layer", s: "Rebrowser · Camoufox" },
              { x: 340, l: "provider adapters", s: "24 sources · normalized" },
              { x: 540, l: "cloud router", s: "auth · quota · meter" },
            ].map((n) => (
              <g key={n.l}>
                <rect x={n.x} y={316} width={200} height={50} rx={8} className="n-sub" />
                <text x={n.x + 100} y={338} textAnchor="middle" className="lbl-sm">
                  {n.l}
                </text>
                <text x={n.x + 100} y={354} textAnchor="middle" className="sub">
                  {n.s}
                </text>
              </g>
            ))}

            {/* provider endpoints row */}
            <rect
              x="30"
              y="400"
              width="820"
              height="70"
              rx={8}
              fill="url(#dots)"
              stroke="#2a2a30"
            />
            <text x="440" y="424" textAnchor="middle" className="lbl-sm">
              24 provider endpoints
            </text>
            <text x="440" y="442" textAnchor="middle" className="sub">
              wikimedia · openverse · unsplash · pexels · nasa · smithsonian · met · loc · spotify ·
              musicbrainz · brave · bing · serpapi · ...
            </text>
            <text x="440" y="460" textAnchor="middle" className="sub">
              api.getwebfetch.com · app.getwebfetch.com
            </text>
          </svg>
        </div>
      </FadeUp>
    </section>
  );
}
