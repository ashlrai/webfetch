import { FAQ } from "@/components/FAQ";
import { PricingTable } from "@/components/PricingTable";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free, Pro ($19), Team ($79 + seats), Enterprise. Usage-based metering on top of every tier.",
};

export default function PricingPage() {
  return (
    <>
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-8 text-center">
        <h1 className="text-5xl font-semibold tracking-tight">
          Simple pricing. Transparent metering.
        </h1>
        <p className="mt-4 text-lg text-[var(--fg-dim)]">
          Self-host unlimited for free. Upgrade when you need managed browser, pooled keys, or a
          team workspace.
        </p>
      </section>
      <PricingTable />
      <section className="max-w-4xl mx-auto px-6 py-12">
        <div className="wf-card">
          <div className="text-lg font-semibold">Per-fetch economics</div>
          <p className="mt-2 text-[var(--fg-dim)] leading-relaxed">
            Pro overage is <span className="font-mono text-[var(--accent)]">$0.015</span> per fetch.
            Team is <span className="font-mono text-[var(--accent)]">$0.010</span> per fetch. Cached
            results, failed calls, and local-only usage are never counted.
          </p>
        </div>
      </section>
      <FAQ />
    </>
  );
}
