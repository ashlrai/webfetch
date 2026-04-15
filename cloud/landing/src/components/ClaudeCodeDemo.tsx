"use client";
import { useEffect, useRef, useState } from "react";

const USER_PROMPT = "Find me a CC0 image of Saturn for my blog post";

type Phase =
  | "idle"
  | "typing"
  | "thinking"
  | "tool-call"
  | "tool-running"
  | "tool-result"
  | "assistant"
  | "rest";

const TOOL_CALL_JSON = `{
  "name": "mcp__webfetch__search_images",
  "input": {
    "query": "saturn planet",
    "license": "safe-only",
    "limit": 4
  }
}`;

const TOOL_RESULT_SUMMARY = `ranked 4 candidates in 218ms — top: saturn-during-equinox.jpg (CC0 / Public Domain, NASA/JPL/Cassini)`;

const ASSISTANT_REPLY =
  "Found one. This is a Cassini image of Saturn at equinox — NASA/JPL, Public Domain, attribution-ready. Dropping it in with a sidecar caption.";

export function ClaudeCodeDemo() {
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [assistantTyped, setAssistantTyped] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const push = (fn: () => void, ms: number) => {
      timers.current.push(setTimeout(fn, ms));
    };

    const cycle = () => {
      setTyped("");
      setAssistantTyped("");
      setPhase("typing");

      for (let i = 1; i <= USER_PROMPT.length; i++) {
        push(() => setTyped(USER_PROMPT.slice(0, i)), i * 38);
      }
      const typeEnd = USER_PROMPT.length * 38 + 450;
      push(() => setPhase("thinking"), typeEnd);
      push(() => setPhase("tool-call"), typeEnd + 700);
      push(() => setPhase("tool-running"), typeEnd + 1400);
      push(() => setPhase("tool-result"), typeEnd + 2300);
      push(() => setPhase("assistant"), typeEnd + 3000);

      for (let i = 1; i <= ASSISTANT_REPLY.length; i++) {
        push(() => setAssistantTyped(ASSISTANT_REPLY.slice(0, i)), typeEnd + 3000 + i * 18);
      }
      const assistEnd = typeEnd + 3000 + ASSISTANT_REPLY.length * 18;
      push(() => setPhase("rest"), assistEnd + 300);
      push(cycle, assistEnd + 5000);
    };
    cycle();
    return clear;
  }, []);

  const show = (p: Phase) => {
    const order: Phase[] = [
      "idle",
      "typing",
      "thinking",
      "tool-call",
      "tool-running",
      "tool-result",
      "assistant",
      "rest",
    ];
    return order.indexOf(phase) >= order.indexOf(p);
  };

  return (
    <section
      id="mcp"
      aria-label="Claude Code MCP integration demo"
      className="max-w-6xl mx-auto px-6 py-20 md:py-24"
    >
      <div className="text-[11px] font-mono text-[var(--color-accent)] uppercase tracking-[0.2em] mb-3">
        — claude code in action
      </div>
      <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
        <h2 className="font-mono text-[30px] md:text-[36px] font-semibold tracking-[-0.025em] leading-[1.1] max-w-3xl">
          One config line.{" "}
          <span className="text-[var(--color-fg-dim)]">
            Your agent now fetches licensed images.
          </span>
        </h2>
        <div className="text-[12px] font-mono text-[var(--color-fg-dim)]">
          mcp__webfetch__* · 6 tools · zero glue code
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6 items-start">
        {/* LEFT: claude code window */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] overflow-hidden shadow-[0_30px_120px_-40px_rgba(255,90,31,0.25)]">
          {/* titlebar */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-elev-2)]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-2 text-[11px] font-mono text-[var(--color-fg-faint)]">
              Claude Code — blog-post-draft.md
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-[10px] font-mono text-[var(--color-fg-dim)]">
              <span className="wf-live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
              mcp: webfetch
            </span>
          </div>

          <div className="p-5 font-mono text-[13px] min-h-[460px] flex flex-col gap-4">
            {/* user message */}
            <div className="flex gap-3">
              <div className="shrink-0 w-6 h-6 rounded-md bg-[var(--color-accent)] text-[#0a0a0c] flex items-center justify-center text-[11px] font-bold">
                M
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-[var(--color-fg-dim)] uppercase tracking-wider mb-1">
                  you
                </div>
                <div className="text-[var(--color-fg)] leading-relaxed">
                  {typed}
                  {phase === "typing" && <span className="wf-caret" />}
                </div>
              </div>
            </div>

            {/* assistant thinking */}
            {show("thinking") && (
              <div className="flex gap-3">
                <div className="shrink-0 w-6 h-6 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-center text-[11px] text-[var(--color-accent)]">
                  C
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[var(--color-fg-dim)] uppercase tracking-wider mb-1">
                    claude
                  </div>
                  <div className="text-[var(--color-fg-dim)] text-[12px]">
                    {phase === "thinking" ? (
                      <span>
                        thinking<span className="wf-caret" style={{ height: "0.7em" }} />
                      </span>
                    ) : (
                      <span>I&apos;ll search webfetch for a safe-licensed Saturn image.</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* tool call block */}
            {show("tool-call") && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-code-bg)] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elev-2)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[var(--color-fg-dim)] uppercase tracking-wider">
                      tool call
                    </span>
                    <span className="text-[11px] font-mono text-[var(--color-accent)]">
                      mcp__webfetch__search_images
                    </span>
                  </div>
                  {phase === "tool-running" && (
                    <span className="text-[10px] font-mono text-[var(--color-amber)] flex items-center gap-1.5">
                      <span className="wf-live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-amber)]" />
                      running
                    </span>
                  )}
                  {show("tool-result") && (
                    <span className="text-[10px] font-mono text-[var(--color-green)] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
                      ok · 218ms
                    </span>
                  )}
                </div>
                <pre className="px-4 py-3 text-[12px] leading-relaxed text-[var(--color-fg-muted)] overflow-x-auto">
                  {TOOL_CALL_JSON}
                </pre>
              </div>
            )}

            {/* tool result (image candidate) */}
            {show("tool-result") && (
              <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-elev-2)] text-[10px] font-mono text-[var(--color-fg-dim)] uppercase tracking-wider">
                  tool result
                </div>
                <div className="p-3 flex gap-3 items-start">
                  <div className="relative shrink-0 w-[120px] h-[120px] rounded-md overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)]">
                    <img
                      src="/gallery/saturn.jpg"
                      alt="Saturn photographed at equinox by the Cassini spacecraft — NASA/JPL, Public Domain"
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                    <span className="wf-stamp wf-stamp--green" style={{ fontSize: 7, top: 6, right: 6 }}>
                      CC0
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 text-[12px]">
                    <div className="text-[var(--color-fg)] truncate">
                      saturn-during-equinox.jpg
                    </div>
                    <div className="text-[var(--color-fg-dim)] text-[11px] mt-1 leading-snug">
                      {TOOL_RESULT_SUMMARY}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 border border-[var(--color-border)] rounded font-mono text-[var(--color-fg-muted)]">
                        nasa
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 border border-[var(--color-border)] rounded font-mono text-[var(--color-fg-muted)]">
                        1024×1024
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 border border-[var(--color-green)] rounded font-mono text-[var(--color-green)]">
                        score 0.97
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* assistant reply */}
            {show("assistant") && (
              <div className="flex gap-3">
                <div className="shrink-0 w-6 h-6 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-center text-[11px] text-[var(--color-accent)]">
                  C
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[var(--color-fg-dim)] uppercase tracking-wider mb-1">
                    claude
                  </div>
                  <div className="text-[var(--color-fg)] leading-relaxed">
                    {assistantTyped}
                    {phase === "assistant" &&
                      assistantTyped.length < ASSISTANT_REPLY.length && <span className="wf-caret" />}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: install + capability list */}
        <div className="flex flex-col gap-4">
          <div className="wf-card">
            <div className="text-[11px] font-mono text-[var(--color-fg-dim)] uppercase tracking-wider mb-2">
              one-line install
            </div>
            <pre className="bg-[var(--color-code-bg)] rounded-lg p-3 text-[12px] font-mono text-[var(--color-fg-muted)] overflow-x-auto border border-[var(--color-border)]">
{`claude mcp add webfetch -- npx -y @webfetch/mcp`}
            </pre>
            <div className="mt-3 text-[12px] text-[var(--color-fg-dim)] leading-relaxed">
              Also works with Cursor, Cline, Continue, Roo Code, and Codex — same command, different
              host.
            </div>
          </div>

          <div className="wf-card">
            <div className="text-[11px] font-mono text-[var(--color-fg-dim)] uppercase tracking-wider mb-3">
              tools your agent gets
            </div>
            <ul className="flex flex-col gap-2 text-[13px] font-mono">
              {[
                ["search_images", "federated search across 24 providers"],
                ["fetch_image", "download + write XMP sidecar"],
                ["get_license", "resolve license tag for any URL"],
                ["list_providers", "capability + rate introspection"],
                ["search_audio", "cover art + album metadata"],
                ["attribution_block", "ship-ready HTML / Markdown caption"],
              ].map(([name, desc]) => (
                <li
                  key={name}
                  className="flex items-start gap-3 py-1.5 border-b border-[var(--color-border)] last:border-none"
                >
                  <span className="text-[var(--color-accent)] shrink-0">{name}</span>
                  <span className="text-[var(--color-fg-dim)] text-[12px]">{desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
