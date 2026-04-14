import Link from "next/link";
import { Hero } from "@/components/Hero";
import { ProviderMatrix } from "@/components/ProviderMatrix";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";

const FEATURES = [
  {
    title: "License-first ranking",
    body: "Candidates are sorted by license tag (CC0 > PUBLIC_DOMAIN > CC_BY > CC_BY_SA > EDITORIAL), then by metadata confidence. UNKNOWN is rejected by default.",
  },
  {
    title: "19+ federated sources",
    body: "Wikimedia, Openverse, Unsplash, Pexels, Pixabay, NASA, Smithsonian, Met Museum, LOC, iTunes, MusicBrainz CAA, Spotify, and more — one interface.",
  },
  {
    title: "Human-like browser fallback",
    body: "When public APIs miss, an opt-in managed browser pulls from Google Images and Pinterest. Every result gets an attribution sidecar.",
  },
  {
    title: "Native MCP integration",
    body: "One config line installs into Claude Code, Cursor, Cline, Continue, Roo Code, and Codex. Your agent gets a stable fetch tool it can reason about.",
  },
];

export default function Home() {
  return (
    <>
      <Hero />

      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-semibold tracking-tight mb-3">
          Shipping an image used to take an afternoon.
        </h2>
        <p className="text-[var(--fg-dim)] max-w-2xl mb-10">
          Four failure modes, fixed at the protocol layer.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="wf-card">
              <div className="text-lg font-semibold">{f.title}</div>
              <p className="mt-2 text-[var(--fg-dim)] leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <ArchitectureDiagram />
      <ProviderMatrix />

      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="flex items-end justify-between mb-6">
          <h2 className="text-3xl font-semibold tracking-tight">webfetch vs alternatives</h2>
          <Link href="/compare" className="text-sm text-[var(--accent)]">
            Full comparison →
          </Link>
        </div>
        <ComparisonTable />
      </section>

      <section className="max-w-4xl mx-auto px-6 py-24 text-center">
        <h2 className="text-4xl font-semibold tracking-tight">
          Start free. Pay for the parts you can't build.
        </h2>
        <p className="mt-4 text-[var(--fg-dim)]">
          OSS unlimited on your machine. Managed browser, pooled keys, and audit logs in the cloud.
        </p>
        <div className="mt-8 flex gap-3 justify-center">
          <a href="https://app.webfetch.dev/signup" className="wf-btn-primary">
            Start free
          </a>
          <Link href="/pricing" className="wf-btn-ghost">
            See pricing
          </Link>
        </div>
      </section>
    </>
  );
}
