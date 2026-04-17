"use client";
import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const COMMAND = `webfetch search "drake" --site fan-hub --license safe-only`;

const DRAKE = {
  portrait: "/gallery/drake-portrait-600.webp",
  performing: "/gallery/drake-performing-600.webp",
  studio: "/gallery/drake-studio-600.webp",
} as const;

type Tile = {
  src: string;
  pos: string;
};

const TILES: Tile[] = [
  { src: DRAKE.portrait, pos: "50% 18%" },
  { src: DRAKE.studio, pos: "50% 30%" },
  { src: DRAKE.performing, pos: "55% 25%" },
  { src: DRAKE.portrait, pos: "40% 35%" },
  { src: DRAKE.studio, pos: "62% 22%" },
  { src: DRAKE.performing, pos: "45% 40%" },
];

// Phases:
// 0 typing  · CLI types the command
// 1 search  · "federating 24 sources..."
// 2 results · result tiles cascade in
// 3 handoff · "rendering site..." pill, browser frame slides up
// 4 site    · polished site materializes
// 5 rest    · pause, then loop
type Phase = 0 | 1 | 2 | 3 | 4 | 5;

// Fixed dark palette — mockup must look identical in light and dark modes.
const ink = {
  bg: "#0c0c10",
  bgElev: "#16161c",
  bgElev2: "#1f1f27",
  border: "#2c2c36",
  borderSoft: "rgba(255,255,255,0.06)",
  fg: "#f3f3f5",
  fgDim: "#9090a0",
  fgFaint: "#5a5a68",
  accent: "#ff5a1f",
  green: "#4ade80",
  cc: "#9cd9ff",
};

// macOS-style window controls reused for the terminal + browser chrome.
function TrafficLights(): React.JSX.Element {
  return (
    <>
      <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
      <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
      <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
    </>
  );
}

// Shared chrome bar style — same elevated bg + border for terminal header,
// browser header, and site footer band.
const chromeBarStyle = { background: ink.bgElev2, borderColor: ink.border };

// Polished-site copy palette (white-on-dark inside the rendered browser frame).
const siteFg = {
  primary: "rgba(255,255,255,0.85)",
  body: "rgba(255,255,255,0.72)",
  muted: "rgba(255,255,255,0.6)",
  border: "rgba(255,255,255,0.12)",
};

const GALLERY_ITEMS = [
  { src: DRAKE.performing, pos: "55% 25%", credit: "Brennan Schnell · CC BY-SA" },
  { src: DRAKE.studio, pos: "50% 30%", credit: "GabboT · CC BY-SA" },
  { src: DRAKE.portrait, pos: "40% 35%", credit: "Come Up Show · CC BY-SA" },
  { src: DRAKE.performing, pos: "45% 40%", credit: "Brennan Schnell · CC BY-SA" },
] as const;

// Reveal helper — toggles opacity + small translate based on `shown`.
// Static class strings only (Tailwind JIT can't see interpolated names).
const REVEAL_VARIANTS = {
  up: "transition-all duration-500 opacity-0 -translate-y-1",
  down: "transition-all duration-500 opacity-0 translate-y-1",
  "down-lg": "transition-all duration-500 opacity-0 translate-y-3",
  scale: "transition-all duration-700 opacity-0 scale-90",
} as const;
const REVEAL_SHOWN = {
  up: "transition-all duration-500 opacity-100 translate-y-0",
  down: "transition-all duration-500 opacity-100 translate-y-0",
  "down-lg": "transition-all duration-500 opacity-100 translate-y-0",
  scale: "transition-all duration-700 opacity-100 scale-100",
} as const;
function revealClass(shown: boolean, from: keyof typeof REVEAL_VARIANTS = "down"): string {
  return shown ? REVEAL_SHOWN[from] : REVEAL_VARIANTS[from];
}

export function HeroScene() {
  const [phase, setPhase] = useState<Phase>(0);
  const [typed, setTyped] = useState("");
  const [tilesShown, setTilesShown] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let alive = true;
    if (prefersReducedMotion()) {
      setTyped(COMMAND);
      setTilesShown(TILES.length);
      setPhase(5);
      return;
    }
    const push = (fn: () => void, ms: number) => {
      timers.current.push(
        setTimeout(() => {
          if (!alive) return;
          fn();
        }, ms),
      );
    };
    const clear = () => {
      alive = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const cycle = () => {
      setPhase(0);
      setTyped("");
      setTilesShown(0);
      for (let i = 1; i <= COMMAND.length; i++) {
        push(() => setTyped(COMMAND.slice(0, i)), i * 28);
      }
      const typingEnd = COMMAND.length * 28 + 350;
      push(() => setPhase(1), typingEnd);
      push(() => setPhase(2), typingEnd + 700);
      for (let i = 1; i <= TILES.length; i++) {
        push(() => setTilesShown(i), typingEnd + 700 + i * 110);
      }
      const resultsEnd = typingEnd + 700 + TILES.length * 110;
      push(() => setPhase(3), resultsEnd + 350);
      push(() => setPhase(4), resultsEnd + 950);
      push(() => setPhase(5), resultsEnd + 2200);
      push(cycle, resultsEnd + 7000);
    };
    cycle();
    return clear;
  }, []);

  const showResults = phase >= 2;
  const showSite = phase >= 4;
  const browserUp = phase >= 3;

  return (
    <div className="relative">
      {/* glow backdrop */}
      <div
        aria-hidden
        className="absolute -inset-10 -z-10 opacity-70 blur-3xl pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 70% 30%, rgba(255,90,31,0.22), transparent 70%), radial-gradient(50% 60% at 20% 80%, rgba(74,158,255,0.14), transparent 70%)",
        }}
      />

      {/* Terminal */}
      <div
        className="rounded-xl overflow-hidden font-mono text-[12.5px] relative z-10 border"
        style={{
          background: ink.bgElev,
          borderColor: ink.border,
          boxShadow: "0 30px 120px -40px rgba(255,90,31,0.4), 0 1px 0 rgba(255,255,255,0.04) inset",
          color: ink.fg,
        }}
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b" style={chromeBarStyle}>
          <TrafficLights />
          <span className="ml-2 text-[11px]" style={{ color: ink.fgFaint }}>
            ~ — webfetch
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[10px]" style={{ color: ink.fgDim }}>
            <span className="wf-live-dot w-1.5 h-1.5 rounded-full" style={{ background: ink.green }} />
            live
          </span>
        </div>
        <div className="px-5 py-3.5 min-h-[140px]">
          <div className="whitespace-pre-wrap break-all">
            <span style={{ color: ink.accent }}>$ </span>
            <span style={{ color: ink.fg }}>{typed}</span>
            {phase === 0 && <span className="wf-caret" />}
          </div>

          {phase >= 1 && (
            <div className="mt-2.5 flex items-center gap-2 text-[12px]" style={{ color: ink.fgDim }}>
              <span className="wf-spinner" aria-hidden />
              <span>federating 24 providers · ranking by license + relevance</span>
            </div>
          )}

          {phase >= 2 && (
            <div className="mt-2 text-[12px]" style={{ color: ink.green }}>
              ✓ ranked {TILES.length} candidates in 412ms · all attributed
            </div>
          )}

          {phase >= 3 && (
            <div className="mt-2 text-[12px] flex items-center gap-1.5" style={{ color: ink.accent }}>
              <span className="wf-arrow-pulse">→</span>
              <span>
                handing off to{" "}
                <span className="underline decoration-dotted underline-offset-2">drakearchive.com</span>{" "}
                renderer…
              </span>
            </div>
          )}

          {showResults && (
            <div className="mt-3 grid grid-cols-6 gap-2">
              {TILES.map((t, i) => (
                <div
                  key={`tile-${i}`}
                  className={`relative aspect-square rounded-md overflow-hidden border transition-all duration-300 ${
                    i < tilesShown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
                  }`}
                  style={{
                    transitionDelay: `${i * 30}ms`,
                    borderColor: ink.border,
                    background: ink.bg,
                  }}
                >
                  <img
                    src={t.src}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{ objectPosition: t.pos }}
                    decoding="async"
                  />
                  <span
                    className="absolute bottom-0.5 right-0.5 text-[8px] font-bold tracking-wider px-1 py-px rounded"
                    style={{ background: "rgba(0,0,0,0.7)", color: ink.cc }}
                  >
                    CC
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Browser frame — slides up under terminal */}
      <div
        className={`relative z-0 -mt-3 transition-all duration-700 ease-out ${
          browserUp ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8 pointer-events-none"
        }`}
        style={{ transitionDelay: browserUp ? "100ms" : "0ms" }}
      >
        <div
          className="rounded-xl overflow-hidden border"
          style={{
            background: ink.bgElev,
            borderColor: ink.border,
            boxShadow: "0 50px 140px -40px rgba(0,0,0,0.7)",
            color: ink.fg,
          }}
        >
          {/* browser chrome */}
          <div className="flex items-center gap-2 px-4 py-2 border-b" style={chromeBarStyle}>
            <TrafficLights />
            <div
              className="ml-3 flex-1 max-w-[280px] flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border"
              style={{
                background: "rgba(255,255,255,0.04)",
                borderColor: ink.borderSoft,
                color: ink.fgDim,
              }}
            >
              <span style={{ color: ink.green }}>●</span>
              <span className="truncate">drakearchive.com</span>
            </div>
            <span
              className="ml-auto text-[10px] font-mono hidden sm:inline"
              style={{ color: ink.fgFaint }}
            >
              built by webfetch
            </span>
          </div>

          {/* site body */}
          <div className="relative">
            {/* hero band */}
            <div className="relative overflow-hidden">
              <div
                className={`absolute inset-0 transition-opacity duration-500 ${
                  showSite ? "opacity-100" : "opacity-0"
                }`}
                style={{
                  background:
                    "linear-gradient(135deg, rgba(255,90,31,0.22), rgba(74,90,158,0.22))",
                }}
              />
              <div className="relative px-5 pt-5 pb-4 grid grid-cols-[1.4fr_1fr] gap-4 items-end">
                <div>
                  <div
                    className={`text-[9px] font-mono tracking-[0.25em] uppercase ${revealClass(showSite, "up")}`}
                    style={{ color: ink.accent }}
                  >
                    The OVO Archive
                  </div>
                  <div
                    className={`mt-1 font-mono font-semibold tracking-[-0.04em] text-[28px] leading-[0.95] ${revealClass(showSite)}`}
                    style={{ color: "#ffffff", transitionDelay: "100ms" }}
                  >
                    DRAKE.
                  </div>
                  <div
                    className={`mt-2 text-[11px] max-w-[28ch] leading-snug ${revealClass(showSite)}`}
                    style={{ color: siteFg.body, transitionDelay: "200ms" }}
                  >
                    Every photo licensed. Every credit intact. Updated automatically.
                  </div>
                </div>
                <div
                  className={`relative aspect-[4/5] rounded-lg overflow-hidden border ${revealClass(showSite, "scale")}`}
                  style={{
                    borderColor: siteFg.border,
                    boxShadow: "0 20px 60px -20px rgba(0,0,0,0.7)",
                    transitionDelay: "150ms",
                  }}
                >
                  <img
                    src={DRAKE.portrait}
                    alt=""
                    className="w-full h-full object-cover"
                    style={{ objectPosition: "50% 22%" }}
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 px-2 py-1 text-[8px] font-mono"
                    style={{
                      background:
                        "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
                      color: siteFg.primary,
                    }}
                  >
                    The Come Up Show · CC BY-SA 2.0
                  </div>
                </div>
              </div>
            </div>

            {/* gallery row */}
            <div className="px-5 pt-2 pb-4">
              <div className="flex items-center justify-between">
                <div
                  className="text-[10px] font-mono uppercase tracking-wider"
                  style={{ color: siteFg.muted }}
                >
                  Latest performances
                </div>
                <div className="text-[10px] font-mono" style={{ color: ink.accent }}>
                  view all →
                </div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {GALLERY_ITEMS.map((g, i) => (
                  <div
                    key={`g-${i}`}
                    className={`relative aspect-square rounded-md overflow-hidden border ${revealClass(showSite, "down-lg")}`}
                    style={{
                      borderColor: siteFg.border,
                      transitionDelay: `${250 + i * 70}ms`,
                    }}
                  >
                    <img
                      src={g.src}
                      alt=""
                      className="w-full h-full object-cover"
                      style={{ objectPosition: g.pos }}
                    />
                    <div
                      className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-[7px] font-mono truncate"
                      style={{
                        background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
                        color: "rgba(255,255,255,0.8)",
                      }}
                    >
                      {g.credit}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* footer band */}
            <div
              className={`px-5 py-2.5 border-t flex items-center justify-between text-[10px] font-mono transition-opacity duration-500 ${
                showSite ? "opacity-100" : "opacity-0"
              }`}
              style={{ ...chromeBarStyle, transitionDelay: "550ms" }}
            >
              <span style={{ color: siteFg.muted }}>
                6 images · 3 sources · 100% attributed
              </span>
              <span className="flex items-center gap-1.5" style={{ color: siteFg.primary }}>
                <span className="inline-block w-1.5 h-1.5 rounded-sm" style={{ background: ink.accent }} />
                powered by webfetch
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
