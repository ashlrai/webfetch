import { FadeUp } from "./FadeUp";

/* Inline SVG illustrations. Terminal palette: mono lines + accent highlight. */

function IllStamps() {
  return (
    <svg viewBox="0 0 320 160" className="w-full h-auto" aria-hidden>
      <defs>
        <pattern id="stampInk1" x="0" y="0" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="#d63a2f" fillOpacity="0.15" />
          <circle cx="1" cy="1" r="0.6" fill="#d63a2f" fillOpacity="0.5" />
        </pattern>
      </defs>
      {/* Stack of papers rotated */}
      <g transform="translate(40,28)">
        <rect x="0" y="0" width="170" height="100" rx="6" fill="#1a1a20" stroke="#3a3a45" transform="rotate(-6)" />
        <rect x="10" y="10" width="170" height="100" rx="6" fill="#121216" stroke="#2a2a30" transform="rotate(-2)" />
        <rect x="20" y="20" width="170" height="100" rx="6" fill="#1a1a20" stroke="#3a3a45" />
        {/* content lines */}
        <g transform="translate(20,20)">
          <rect x="14" y="14" width="80" height="6" rx="2" fill="#2a2a30" />
          <rect x="14" y="26" width="130" height="4" rx="2" fill="#2a2a30" />
          <rect x="14" y="36" width="110" height="4" rx="2" fill="#2a2a30" />
          <rect x="14" y="46" width="120" height="4" rx="2" fill="#2a2a30" />
          <rect x="14" y="56" width="96" height="4" rx="2" fill="#2a2a30" />
          {/* green approve stamp */}
          <g transform="translate(102,60) rotate(-8)">
            <rect x="0" y="0" width="44" height="22" fill="url(#stampInk1)" stroke="#4ade80" strokeWidth="1.5" rx="2" />
            <text x="22" y="15" textAnchor="middle" fontFamily="ui-monospace,Menlo" fontSize="9" fontWeight="700" fill="#4ade80" letterSpacing="0.08em">CC0</text>
          </g>
        </g>
        {/* rejected paper falling aside */}
        <g transform="translate(190,60) rotate(18)" opacity="0.7">
          <rect x="0" y="0" width="90" height="60" rx="4" fill="#121216" stroke="#2a2a30" />
          <rect x="8" y="10" width="44" height="4" fill="#2a2a30" />
          <rect x="8" y="18" width="60" height="3" fill="#2a2a30" />
          <g transform="translate(44,30) rotate(-12)">
            <rect x="0" y="0" width="46" height="18" stroke="#f87171" strokeWidth="1.5" fill="none" rx="2" />
            <text x="23" y="13" textAnchor="middle" fontFamily="ui-monospace,Menlo" fontSize="8" fontWeight="700" fill="#f87171">UNKNOWN</text>
          </g>
        </g>
      </g>
    </svg>
  );
}

function IllOrbit() {
  return (
    <svg viewBox="0 0 320 160" className="w-full h-auto" aria-hidden>
      <circle cx="160" cy="80" r="56" fill="none" stroke="#2a2a30" strokeDasharray="2 3" />
      <circle cx="160" cy="80" r="38" fill="none" stroke="#2a2a30" strokeDasharray="2 3" />
      <circle cx="160" cy="80" r="18" fill="#121216" stroke="#ff5a1f" strokeWidth="1.5" />
      <text x="160" y="84" textAnchor="middle" fontFamily="ui-monospace,Menlo" fontSize="10" fontWeight="600" fill="#f0f0f2">core</text>
      {/* satellite nodes */}
      {[
        { x: 216, y: 80, l: "wiki" },
        { x: 160, y: 24, l: "openverse" },
        { x: 104, y: 80, l: "nasa" },
        { x: 160, y: 136, l: "met" },
        { x: 200, y: 42, l: "unsplash" },
        { x: 120, y: 118, l: "loc" },
        { x: 200, y: 118, l: "pexels" },
        { x: 120, y: 42, l: "spotify" },
      ].map((n) => (
        <g key={n.l}>
          <circle cx={n.x} cy={n.y} r="4" fill="#ff5a1f" />
          <text x={n.x + 7} y={n.y + 3} fontFamily="ui-monospace,Menlo" fontSize="8" fill="#8a8a95">{n.l}</text>
        </g>
      ))}
    </svg>
  );
}

function IllBrowser() {
  return (
    <svg viewBox="0 0 320 160" className="w-full h-auto" aria-hidden>
      <rect x="40" y="28" width="240" height="108" rx="8" fill="#121216" stroke="#2a2a30" />
      <rect x="40" y="28" width="240" height="22" rx="8" fill="#1a1a20" stroke="#2a2a30" />
      <rect x="40" y="44" width="240" height="6" fill="#1a1a20" />
      <circle cx="52" cy="39" r="3" fill="#ff5f57" />
      <circle cx="62" cy="39" r="3" fill="#febc2e" />
      <circle cx="72" cy="39" r="3" fill="#28c840" />
      <rect x="88" y="34" width="168" height="11" rx="5" fill="#0a0a0c" stroke="#2a2a30" />
      <text x="96" y="42" fontFamily="ui-monospace,Menlo" fontSize="7" fill="#8a8a95">images.google.com/search?q=</text>
      <text x="200" y="42" fontFamily="ui-monospace,Menlo" fontSize="7" fill="#ff5a1f">drake portrait</text>
      {/* result tiles */}
      <g transform="translate(52,60)">
        <rect width="50" height="50" rx="3" fill="#2a2a30" />
        <rect x="58" width="50" height="50" rx="3" fill="#2a2a30" />
        <rect x="116" width="50" height="50" rx="3" fill="#ff5a1f" fillOpacity="0.35" stroke="#ff5a1f" />
        <rect x="174" width="50" height="50" rx="3" fill="#2a2a30" />
        <rect y="56" width="50" height="18" rx="2" fill="#1a1a20" />
        <rect x="58" y="56" width="50" height="18" rx="2" fill="#1a1a20" />
        <rect x="116" y="56" width="50" height="18" rx="2" fill="#1a1a20" />
        <rect x="174" y="56" width="50" height="18" rx="2" fill="#1a1a20" />
      </g>
      {/* cursor */}
      <path d="M 180 88 L 180 102 L 184 98 L 188 106 L 191 104 L 187 97 L 192 96 Z" fill="#ff5a1f" stroke="#0a0a0c" strokeWidth="0.5" />
    </svg>
  );
}

function IllMcp() {
  return (
    <svg viewBox="0 0 320 160" className="w-full h-auto" aria-hidden>
      {/* central server */}
      <rect x="130" y="60" width="60" height="40" rx="4" fill="#121216" stroke="#ff5a1f" />
      <text x="160" y="84" textAnchor="middle" fontFamily="ui-monospace,Menlo" fontSize="9" fontWeight="600" fill="#f0f0f2">mcp</text>
      {/* clients */}
      {[
        { x: 30, y: 28, l: "Claude" },
        { x: 30, y: 88, l: "Cursor" },
        { x: 240, y: 28, l: "VS Code" },
        { x: 240, y: 88, l: "Continue" },
      ].map((c) => (
        <g key={c.l}>
          <rect x={c.x} y={c.y} width={56} height={26} rx="4" fill="#1a1a20" stroke="#2a2a30" />
          <text x={c.x + 28} y={c.y + 17} textAnchor="middle" fontFamily="ui-monospace,Menlo" fontSize="9" fill="#c5c5cc">{c.l}</text>
        </g>
      ))}
      {/* wires */}
      <g stroke="#ff5a1f" strokeOpacity="0.6" strokeWidth="1" fill="none">
        <path d="M 86 41 Q 110 60 130 72" />
        <path d="M 86 101 Q 110 100 130 90" />
        <path d="M 240 41 Q 216 60 190 72" />
        <path d="M 240 101 Q 216 100 190 90" />
      </g>
      <text x="160" y="142" textAnchor="middle" fontFamily="ui-monospace,Menlo" fontSize="9" fill="#8a8a95">one config line — six agents</text>
    </svg>
  );
}

function IllXmp() {
  return (
    <svg viewBox="0 0 320 160" className="w-full h-auto" aria-hidden>
      {/* image file */}
      <g transform="translate(56,24)">
        <path d="M 0 0 L 70 0 L 90 20 L 90 112 L 0 112 Z" fill="#121216" stroke="#2a2a30" />
        <path d="M 70 0 L 70 20 L 90 20" fill="#1a1a20" stroke="#2a2a30" />
        <rect x="10" y="30" width="70" height="50" rx="2" fill="#ff5a1f" fillOpacity="0.25" stroke="#ff5a1f" strokeOpacity="0.4" />
        <text x="10" y="94" fontFamily="ui-monospace,Menlo" fontSize="8" fill="#8a8a95">drake.jpg</text>
        <text x="10" y="104" fontFamily="ui-monospace,Menlo" fontSize="7" fill="#4a4a55">+ XMP</text>
      </g>
      {/* sidecar */}
      <g transform="translate(172,24)">
        <rect width="108" height="112" rx="4" fill="#0f0f13" stroke="#2a2a30" />
        <text x="8" y="16" fontFamily="ui-monospace,Menlo" fontSize="7" fill="#ff5a1f">drake.jpg.xmp</text>
        <line x1="8" y1="22" x2="100" y2="22" stroke="#2a2a30" />
        <g fontFamily="ui-monospace,Menlo" fontSize="7" fill="#c5c5cc">
          <text x="8" y="36">license: CC-BY-SA</text>
          <text x="8" y="48">creator: wiki...</text>
          <text x="8" y="60">source: commons</text>
          <text x="8" y="72">rights: attrib</text>
          <text x="8" y="84">sha256: 7f2a..</text>
          <text x="8" y="96">fetched: 2026</text>
        </g>
      </g>
      <path d="M 146 80 L 170 80" stroke="#ff5a1f" strokeWidth="1" markerEnd="url(#arrh)" />
      <defs>
        <marker id="arrh" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 Z" fill="#ff5a1f" />
        </marker>
      </defs>
    </svg>
  );
}

function IllPrivacy() {
  return (
    <svg viewBox="0 0 320 160" className="w-full h-auto" aria-hidden>
      {/* Toggle */}
      <g transform="translate(100,58)">
        <rect width="120" height="44" rx="22" fill="#121216" stroke="#2a2a30" />
        <circle cx="22" cy="22" r="14" fill="#1a1a20" stroke="#4a4a55" />
        <text x="96" y="26" textAnchor="middle" fontFamily="ui-monospace,Menlo" fontSize="10" fill="#8a8a95">off</text>
      </g>
      <text x="160" y="42" textAnchor="middle" fontFamily="ui-monospace,Menlo" fontSize="10" fill="#c5c5cc">telemetry</text>
      <text x="160" y="130" textAnchor="middle" fontFamily="ui-monospace,Menlo" fontSize="9" fill="#8a8a95">opt-in · local-first · zero trackers</text>
    </svg>
  );
}

const FEATURES = [
  {
    title: "License-first ranking",
    body: "Candidates are sorted by license tag (CC0 > PUBLIC_DOMAIN > CC_BY > CC_BY_SA > EDITORIAL), then metadata confidence. UNKNOWN is rejected by default.",
    ill: <IllStamps />,
  },
  {
    title: "24 federated providers",
    body: "Wikimedia, Openverse, Unsplash, Pexels, Pixabay, NASA, Smithsonian, Met Museum, LOC, iTunes, MusicBrainz CAA, Spotify — one interface.",
    ill: <IllOrbit />,
  },
  {
    title: "Human-like browser fallback",
    body: "When public APIs miss, an opt-in managed browser pulls from Google Images and Pinterest. Every result ships an attribution sidecar.",
    ill: <IllBrowser />,
  },
  {
    title: "Native MCP integration",
    body: "One config line installs into Claude Code, Cursor, Cline, Continue, Roo Code, and Codex. Your agent gets a stable fetch tool it can reason about.",
    ill: <IllMcp />,
  },
  {
    title: "Attribution sidecars",
    body: "Every download writes an XMP sidecar with license, creator, source, rights, and SHA-256. Audit-ready by default, no extra work.",
    ill: <IllXmp />,
  },
  {
    title: "Privacy-first telemetry",
    body: "Local runs phone home to nothing. Cloud telemetry is opt-in and pseudonymous. No third-party trackers, ever.",
    ill: <IllPrivacy />,
  },
];

export function Features() {
  return (
    <section id="features" className="max-w-6xl mx-auto px-6 py-20 md:py-24">
      <FadeUp>
        <div className="text-[11px] font-mono text-[var(--color-accent)] uppercase tracking-[0.2em] mb-3">
          — features
        </div>
        <h2 className="font-mono text-[30px] md:text-[36px] font-semibold tracking-[-0.025em] leading-[1.1] max-w-3xl">
          Shipping an image used to take an afternoon.
        </h2>
        <p className="mt-4 text-[var(--color-fg-dim)] max-w-2xl leading-relaxed">
          Six failure modes, fixed at the protocol layer.
        </p>
      </FadeUp>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map((f, i) => (
          <FadeUp key={f.title} delay={i * 40}>
            <div className="wf-card h-full flex flex-col">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
                {f.ill}
              </div>
              <div className="mt-4 text-[15px] font-mono font-semibold text-[var(--color-fg)]">
                {f.title}
              </div>
              <p className="mt-2 text-[14px] text-[var(--color-fg-dim)] leading-relaxed">
                {f.body}
              </p>
            </div>
          </FadeUp>
        ))}
      </div>
    </section>
  );
}
