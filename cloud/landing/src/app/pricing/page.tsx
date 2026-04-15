import { FAQ } from "@/components/FAQ";
import { PricingTable } from "@/components/PricingTable";
import { buildBreadcrumbJsonLd } from "@/lib/breadcrumbs";
import type { Metadata } from "next";

const BREADCRUMB_JSONLD = buildBreadcrumbJsonLd([
  { name: "Pricing", path: "/pricing" },
]);

export const metadata: Metadata = {
  title: "Pricing — Free, Pro, Team, Enterprise",
  description:
    "Free: 10 no-key providers, zero signups required. Pro $19: pooled SerpAPI, Brave, Unsplash, Pexels, Pixabay, Spotify, Flickr, Europeana keys plus managed browser fallback. Team $79: shared pool across seats + Bright Data browser at 50k fetches/mo.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "webfetch pricing — free self-host, Pro from $19",
    description:
      "Free, Pro ($19), Team ($79 + seats), Enterprise. Transparent usage metering on every tier.",
    url: "https://getwebfetch.com/pricing",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "webfetch pricing",
    description: "Free self-host. Pro from $19. Transparent usage metering.",
    images: ["/og-image.png"],
  },
};

const PRICING_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "webfetch",
  description:
    "License-first federated image search API, CLI, and MCP. Free self-host, Pro, Team, and Enterprise tiers.",
  brand: { "@type": "Brand", name: "AshlrAI" },
  offers: [
    {
      "@type": "Offer",
      name: "Free",
      description:
        "10 no-key providers included by default (Wikimedia, Openverse, iTunes, MusicBrainz, NASA, Smithsonian, Met, Library of Congress, Wellcome, Burst) — no signup at provider sites required.",
      price: "0",
      priceCurrency: "USD",
      url: "https://getwebfetch.com/pricing",
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "0",
        priceCurrency: "USD",
        unitText: "MONTH",
      },
    },
    {
      "@type": "Offer",
      name: "Pro",
      description:
        "Pooled keys for SerpAPI, Brave Search, Unsplash, Pexels, Pixabay, Spotify, Flickr, Europeana — zero BYOK config. Managed browser fallback for Google Images + Pinterest. 10k fetches/mo included.",
      price: "19",
      priceCurrency: "USD",
      url: "https://getwebfetch.com/pricing",
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "19",
        priceCurrency: "USD",
        unitText: "MONTH",
      },
    },
    {
      "@type": "Offer",
      name: "Team",
      description:
        "Shared pool across seats + Bright Data browser included at 50k fetches/mo. SSO, audit log export, per-seat pricing.",
      price: "79",
      priceCurrency: "USD",
      url: "https://getwebfetch.com/pricing",
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "79",
        priceCurrency: "USD",
        unitText: "MONTH",
      },
    },
    {
      "@type": "Offer",
      name: "Enterprise",
      description: "Dedicated tenant, custom providers, on-prem Node+SQLite build, SLA.",
      priceCurrency: "USD",
      url: "https://getwebfetch.com/pricing",
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "PriceSpecification",
        priceCurrency: "USD",
        description: "Custom pricing",
      },
    },
  ],
};

export default function PricingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
        dangerouslySetInnerHTML={{ __html: JSON.stringify(PRICING_JSONLD) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB_JSONLD) }}
      />
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-8 text-center">
        <h1 className="text-5xl font-semibold tracking-tight">
          Simple pricing. Transparent metering.
        </h1>
        <p className="mt-4 text-lg text-[var(--fg-dim)]">
          Free includes 10 no-key providers out of the box — no signup at provider sites. Pro adds
          pooled keys for SerpAPI, Brave, Unsplash, Pexels, Pixabay, Spotify, Flickr, and Europeana
          plus managed browser fallback. Team adds a shared pool across seats with Bright Data
          included.
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
