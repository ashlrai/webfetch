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

const COMMAND = `webfetch search "drake portrait" --license safe-only`;

type Stamp = "CC0" | "CC-BY" | "CC-BY-SA" | "PUBLIC DOMAIN" | "EDITORIAL";
type Row = {
  provider: string;
  license: string;
  stamp: Stamp;
  score: string;
  thumb: string; // /gallery/xxx-thumb.webp
  sourceHref: string; // attribution / File: page
};

// Real Drake images fetched from Wikimedia Commons — see
// cloud/landing/public/gallery/manifest.json for full attribution.
const DRAKE_THUMBS = {
  portrait: {
    src: "/gallery/drake-portrait-thumb.webp",
    href: "https://commons.wikimedia.org/wiki/File:Drake_July_2016.jpg",
  },
  performing: {
    src: "/gallery/drake-performing-thumb.webp",
    href: "https://commons.wikimedia.org/wiki/File:Drake_Bluesfest_(cropped).jpg",
  },
  studio: {
    src: "/gallery/drake-studio-thumb.webp",
    href: "https://commons.wikimedia.org/wiki/File:Drake_at_The_Carter_Effect_2017_(36818935200)_(cropped).jpg",
  },
} as const;

const RESULTS: Row[] = [
  {
    provider: "wikimedia",
    license: "CC BY-SA 2.0",
    stamp: "CC-BY-SA",
    score: "0.96",
    thumb: DRAKE_THUMBS.portrait.src,
    sourceHref: DRAKE_THUMBS.portrait.href,
  },
  {
    provider: "openverse",
    license: "CC BY-SA 2.0",
    stamp: "CC-BY-SA",
    score: "0.92",
    thumb: DRAKE_THUMBS.studio.src,
    sourceHref: DRAKE_THUMBS.studio.href,
  },
  {
    provider: "wikimedia",
    license: "CC BY-SA 2.0",
    stamp: "CC-BY-SA",
    score: "0.88",
    thumb: DRAKE_THUMBS.performing.src,
    sourceHref: DRAKE_THUMBS.performing.href,
  },
  {
    provider: "openverse",
    license: "CC BY 2.0",
    stamp: "CC-BY",
    score: "0.84",
    thumb: DRAKE_THUMBS.portrait.src,
    sourceHref: DRAKE_THUMBS.portrait.href,
  },
  {
    provider: "musicbrainz",
    license: "Editorial",
    stamp: "EDITORIAL",
    score: "0.79",
    thumb: DRAKE_THUMBS.studio.src,
    sourceHref: DRAKE_THUMBS.studio.href,
  },
  {
    provider: "wikimedia",
    license: "CC BY-SA 2.0",
    stamp: "CC-BY-SA",
    score: "0.71",
    thumb: DRAKE_THUMBS.performing.src,
    sourceHref: DRAKE_THUMBS.performing.href,
  },
];

/**
 * Looping terminal demo: types the command, reveals rows with real Drake
 * thumbnails, pauses, restarts. Total loop ≈ 13.6s.
 */
export function TypingCli() {
  const [typed, setTyped] = useState("");
  const [rows, setRows] = useState(0);
  const [phase, setPhase] = useState<"typing" | "running" | "rows" | "rest">("typing");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setTyped(COMMAND);
      setRows(RESULTS.length);
      setPhase("rest");
      return;
    }

    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const push = (fn: () => void, ms: number) => {
      timers.current.push(setTimeout(fn, ms));
    };

    const runCycle = () => {
      setTyped("");
      setRows(0);
      setPhase("typing");
      for (let i = 1; i <= COMMAND.length; i++) {
        push(() => setTyped(COMMAND.slice(0, i)), i * 32);
      }
      const typeEnd = COMMAND.length * 32 + 400;
      push(() => setPhase("running"), typeEnd);
      push(() => setPhase("rows"), typeEnd + 900);
      for (let i = 1; i <= RESULTS.length; i++) {
        push(() => setRows(i), typeEnd + 900 + i * 80);
      }
      const rowsEnd = typeEnd + 900 + RESULTS.length * 80;
      push(() => setPhase("rest"), rowsEnd + 300);
      push(runCycle, rowsEnd + 3800);
    };
    runCycle();
    return clear;
  }, []);

  const stampColor = (s: Stamp) => {
    if (s === "CC0" || s === "PUBLIC DOMAIN") return "var(--color-green)";
    if (s === "CC-BY" || s === "CC-BY-SA") return "#9cd9ff";
    return "var(--color-amber)";
  };

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] overflow-hidden font-mono text-[13px] shadow-[0_30px_120px_-40px_rgba(255,90,31,0.25)]">
      {/* titlebar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-elev-2)]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[11px] text-[var(--color-fg-faint)]">~ — webfetch</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-[var(--color-fg-dim)]">
          <span className="wf-live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
          live
        </span>
      </div>

      {/* body */}
      <div className="px-5 py-4 min-h-[360px]">
        <div className="whitespace-pre-wrap break-all">
          <span className="text-[var(--color-accent)]">$ </span>
          <span className="text-[var(--color-fg)]">{typed}</span>
          {phase === "typing" && <span className="wf-caret" />}
        </div>

        {phase !== "typing" && (
          <div className="mt-3 text-[var(--color-fg-dim)] text-[12px] flex items-center gap-1.5">
            {phase === "running" ? (
              <>
                <span>[federating 24 providers</span>
                <span className="wf-caret" style={{ height: "0.8em", width: "0.35em" }} />
                <span>]</span>
              </>
            ) : (
              <span>[ranked {RESULTS.length} candidates in 412ms · license-filtered]</span>
            )}
          </div>
        )}

        {phase !== "typing" && phase !== "running" && (
          <div className="mt-3 border border-[var(--color-border)] rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1.1fr_56px_1.4fr_0.9fr_0.55fr_0.55fr] gap-2 px-3 py-2 bg-[var(--color-bg-elev-2)] text-[11px] text-[var(--color-fg-dim)] uppercase tracking-wider">
              <span>provider</span>
              <span>img</span>
              <span>license</span>
              <span>stamp</span>
              <span className="text-right">score</span>
              <span className="text-right">src</span>
            </div>
            {RESULTS.slice(0, rows).map((r, i) => (
              <div
                key={`${r.provider}-${i}`}
                className="grid grid-cols-[1.1fr_56px_1.4fr_0.9fr_0.55fr_0.55fr] gap-2 px-3 py-2 border-t border-[var(--color-border)] items-center wf-row-in"
              >
                <span className="text-[var(--color-accent)] truncate">{r.provider}</span>
                <span className="w-12 h-12 rounded-md overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)]">
                  <img
                    src={r.thumb}
                    alt=""
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                </span>
                <span className="text-[var(--color-fg-muted)] text-[12px] truncate">{r.license}</span>
                <span
                  className="text-[10px] font-bold tracking-wider inline-block px-1.5 py-0.5 border rounded w-fit"
                  style={{
                    color: stampColor(r.stamp),
                    borderColor: stampColor(r.stamp),
                    transform: "rotate(-2deg)",
                  }}
                >
                  {r.stamp}
                </span>
                <span className="text-[var(--color-fg)] text-right">{r.score}</span>
                <span className="text-right">
                  <a
                    href={r.sourceHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--color-fg-dim)] hover:text-[var(--color-accent)] transition-colors underline decoration-dotted underline-offset-2"
                  >
                    open
                  </a>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
