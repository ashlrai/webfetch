import Link from "next/link";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { ProviderMatrix } from "@/components/ProviderMatrix";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";
import { FadeUp } from "@/components/FadeUp";

export default function Home() {
  return (
    <>
      <Hero />
      <Features />
      <ArchitectureDiagram />
      <ProviderMatrix />

      <section className="max-w-6xl mx-auto px-6 py-20 md:py-24">
        <FadeUp>
          <div className="text-[11px] font-mono text-[var(--color-accent)] uppercase tracking-[0.2em] mb-3">
            — comparison
          </div>
          <div className="flex items-end justify-between flex-wrap gap-3 mb-8">
            <h2 className="font-mono text-[30px] md:text-[36px] font-semibold tracking-[-0.025em] leading-[1.1]">
              webfetch vs alternatives
            </h2>
            <Link href="/compare" className="text-sm font-mono text-[var(--color-accent)]">
              Full comparison →
            </Link>
          </div>
        </FadeUp>
        <FadeUp delay={60}>
          <ComparisonTable />
        </FadeUp>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
        <FadeUp>
          <h2 className="font-mono text-[36px] md:text-[48px] font-semibold tracking-[-0.03em] leading-[1.05]">
            Start free.{" "}
            <span className="text-[var(--color-fg-dim)]">
              Pay for the parts you can&apos;t build.
            </span>
          </h2>
          <p className="mt-5 text-[var(--color-fg-dim)] max-w-xl mx-auto leading-relaxed">
            OSS unlimited on your machine. Managed browser, pooled keys, and
            audit logs in the cloud.
          </p>
          <div className="mt-8 flex gap-3 justify-center">
            <a href="https://app.getwebfetch.com/signup" className="wf-btn-primary">
              Start free
            </a>
            <Link href="/pricing" className="wf-btn-ghost">
              See pricing
            </Link>
          </div>
        </FadeUp>
      </section>
    </>
  );
}
