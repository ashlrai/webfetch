import Link from "next/link";
import { InstallCommand } from "./InstallCommand";
import { TypingCli } from "./TypingCli";

export function Hero() {
  return (
    <section className="wf-scanlines overflow-hidden">
      <div className="max-w-6xl mx-auto px-6 pt-16 pb-24 md:pt-24 md:pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
          <div className="flex flex-col items-start gap-6">
            <div className="relative inline-flex items-center gap-2 text-[11px] font-mono text-[var(--color-fg-dim)] border border-[var(--color-border)] rounded-full pl-3 pr-10 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)] wf-live-dot" />
              <span className="uppercase tracking-wider">v1.0</span>
              <span>24 providers · 241 tests · MIT</span>
              <span className="wf-stamp" style={{ top: -10, right: -14, fontSize: 8 }}>
                LICENSED
              </span>
            </div>

            <h1 className="font-mono text-[48px] md:text-[64px] lg:text-[80px] font-semibold tracking-[-0.04em] leading-[0.95] text-[var(--color-fg)]">
              webfetch<span className="text-[var(--color-accent)]">.</span>
            </h1>

            <p className="text-[18px] md:text-[20px] text-[var(--color-fg-muted)] max-w-xl leading-[1.55] -mt-1">
              The license-first image layer for AI agents and humans. One API,
              CLI, and MCP that federates 24 licensed sources, falls through to
              a human-like browser, and always ships attribution.
            </p>

            <div className="pt-1">
              <InstallCommand />
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <a href="https://app.getwebfetch.com/signup" className="wf-btn-primary">
                Start free
              </a>
              <Link href="/docs" className="wf-btn-ghost">
                View docs
              </Link>
            </div>
          </div>

          <div className="lg:pl-4">
            <TypingCli />
          </div>
        </div>
      </div>
    </section>
  );
}
