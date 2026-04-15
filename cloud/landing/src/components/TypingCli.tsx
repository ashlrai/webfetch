"use client";
import { useEffect, useRef, useState } from "react";

const COMMAND = `webfetch search "drake portrait" --license safe-only`;

type Row = {
  provider: string;
  license: string;
  stamp: "CC0" | "CC-BY" | "CC-BY-SA" | "PUBLIC DOMAIN" | "EDITORIAL";
  score: string;
};

const RESULTS: Row[] = [
  { provider: "wikimedia",    license: "CC BY-SA 4.0",    stamp: "CC-BY-SA",      score: "0.96" },
  { provider: "openverse",    license: "CC BY 2.0",       stamp: "CC-BY",         score: "0.92" },
  { provider: "smithsonian",  license: "CC0 1.0",         stamp: "CC0",           score: "0.88" },
  { provider: "met-museum",   license: "CC0 (OA)",        stamp: "CC0",           score: "0.84" },
  { provider: "loc",          license: "Public Domain",   stamp: "PUBLIC DOMAIN", score: "0.79" },
  { provider: "musicbrainz",  license: "Editorial",       stamp: "EDITORIAL",     score: "0.71" },
];

/**
 * Looping terminal demo: types the command, reveals rows, pauses, restarts.
 * Cleanly tears down timers on unmount.
 */
export function TypingCli() {
  const [typed, setTyped] = useState("");
  const [rows, setRows] = useState(0);
  const [phase, setPhase] = useState<"typing" | "running" | "rows" | "rest">("typing");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
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
      // type command char-by-char
      for (let i = 1; i <= COMMAND.length; i++) {
        push(() => setTyped(COMMAND.slice(0, i)), i * 32);
      }
      const typeEnd = COMMAND.length * 32 + 400;
      push(() => setPhase("running"), typeEnd);
      push(() => setPhase("rows"), typeEnd + 700);
      // reveal rows
      for (let i = 1; i <= RESULTS.length; i++) {
        push(() => setRows(i), typeEnd + 700 + i * 140);
      }
      const rowsEnd = typeEnd + 700 + RESULTS.length * 140;
      push(() => setPhase("rest"), rowsEnd + 300);
      push(runCycle, rowsEnd + 3800);
    };
    runCycle();
    return clear;
  }, []);

  const stampColor = (s: Row["stamp"]) => {
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
      <div className="px-5 py-4 min-h-[320px]">
        <div className="whitespace-pre-wrap break-all">
          <span className="text-[var(--color-accent)]">$ </span>
          <span className="text-[var(--color-fg)]">{typed}</span>
          {phase === "typing" && <span className="wf-caret" />}
        </div>

        {phase !== "typing" && (
          <div className="mt-3 text-[var(--color-fg-dim)] text-[12px]">
            {phase === "running" && <span>[federating 24 providers...]</span>}
            {phase !== "running" && (
              <span>[ranked {RESULTS.length} candidates in 412ms · license-filtered]</span>
            )}
          </div>
        )}

        {phase !== "typing" && phase !== "running" && (
          <div className="mt-3 border border-[var(--color-border)] rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1.2fr_1.5fr_1fr_0.6fr] px-3 py-2 bg-[var(--color-bg-elev-2)] text-[11px] text-[var(--color-fg-dim)] uppercase tracking-wider">
              <span>provider</span>
              <span>license</span>
              <span>stamp</span>
              <span className="text-right">score</span>
            </div>
            {RESULTS.slice(0, rows).map((r) => (
              <div
                key={r.provider}
                className="grid grid-cols-[1.2fr_1.5fr_1fr_0.6fr] px-3 py-2 border-t border-[var(--color-border)] items-center"
              >
                <span className="text-[var(--color-accent)]">{r.provider}</span>
                <span className="text-[var(--color-fg-muted)] text-[12px]">{r.license}</span>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
