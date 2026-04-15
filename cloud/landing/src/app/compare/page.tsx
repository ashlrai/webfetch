import { ComparisonTable } from "@/components/ComparisonTable";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Compare",
  description:
    "webfetch vs Google Images, Unsplash, Bing Image Search, and Serper — feature by feature.",
};

export default function ComparePage() {
  return (
    <section className="max-w-5xl mx-auto px-6 py-20">
      <h1 className="text-4xl font-semibold tracking-tight">webfetch vs the alternatives</h1>
      <p className="mt-3 text-[var(--fg-dim)] max-w-2xl">
        Image sourcing has always been "pick one". webfetch picks all of them, ranks by license, and
        adds the missing safety net (attribution, audit trail, browser fallback with opt-in).
      </p>
      <div className="mt-10">
        <ComparisonTable />
      </div>

      <div className="mt-16 space-y-10 prose-wf">
        <div>
          <h2>vs Google Images</h2>
          <p>
            Google's Image Search API was retired in 2011. The only way to script Google Images is
            through third-party scraping (SerpAPI, Serper) or the SERP-less workaround of a browser
            fetcher. None of these return license metadata. webfetch uses Google as a last resort
            (browser fallback, opt-in), and only after trying 19 licensed sources that Google
            doesn't surface.
          </p>
        </div>
        <div>
          <h2>vs Unsplash API</h2>
          <p>
            Unsplash is excellent — it's one of our 19 providers. But Unsplash alone can't cover
            editorial music art, public-domain museum scans, CC-licensed Flickr, government
            archives, or the long tail. One source is one bet.
          </p>
        </div>
        <div>
          <h2>vs Bing Image Search</h2>
          <p>
            Bing returns URLs without license. You have to interpret the "license" filter parameters
            yourself, and the filter is opaque. webfetch lets you use Bing as a provider (opt-in),
            and coerces host-based license heuristics, but never pretends it knows what it doesn't.
          </p>
        </div>
        <div>
          <h2>vs Serper / SerpAPI</h2>
          <p>
            Serper and SerpAPI are excellent SERP scrapers. They surface Google Images results with
            no license data. webfetch uses them (opt-in) as one of 19 providers and attaches a
            host-based heuristic + UNKNOWN tag so you know what you're shipping.
          </p>
        </div>
      </div>
    </section>
  );
}
