import Link from "next/link";
import { InstallCommand } from "./InstallCommand";

export function Hero() {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-20 pb-24">
      <div className="flex flex-col items-start gap-6">
        <div className="inline-flex items-center gap-2 text-xs font-mono text-[var(--fg-dim)] border border-[var(--border)] rounded-full px-3 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          v1.0 out now — 19 providers, 117 tests, MIT licensed
        </div>
        <h1 className="text-5xl md:text-6xl font-semibold tracking-tight max-w-4xl leading-[1.05]">
          The license-first image layer for{" "}
          <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-cool)] bg-clip-text text-transparent">
            AI agents and humans.
          </span>
        </h1>
        <p className="text-lg md:text-xl text-[var(--fg-dim)] max-w-2xl leading-relaxed">
          One API, CLI, and MCP that federates 19+ licensed image sources, falls through to a
          human-like browser when APIs miss, and always ships attribution.
        </p>
        <div className="pt-2">
          <InstallCommand />
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <a href="https://app.webfetch.dev/signup" className="wf-btn-primary">
            Start free
          </a>
          <Link href="/docs" className="wf-btn-ghost">
            View docs
          </Link>
        </div>
      </div>

      <div className="mt-16 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] overflow-hidden aspect-video max-w-5xl mx-auto">
        <video
          src="/demo.mp4"
          poster="/demo-poster.svg"
          controls
          preload="none"
          className="w-full h-full object-cover"
          aria-label="webfetch demo video"
        />
      </div>
    </section>
  );
}
