/**
 * Headless-browser provider — absolute last-resort fallback against
 * images.google.com. OFF BY DEFAULT. Requires BOTH:
 *   - env WEBFETCH_ENABLE_BROWSER=1
 *   - caller explicitly passes "browser" in opts.providers
 *
 * Playwright is imported dynamically so the package has no hard dependency
 * on it. If playwright isn't installed, the provider reports `skipped:
 * missing-auth`.
 *
 * This exists because Google deprecated their Image Search API; direct-source
 * APIs cover the majority of legitimate use cases, and this gives a narrow
 * escape hatch while being loud about the ToS-grey tradeoff.
 */

import { heuristicLicenseFromUrl } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const browser: Provider = {
  id: "browser",
  defaultLicense: "UNKNOWN",
  requiresAuth: false,
  optIn: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    if (process.env.WEBFETCH_ENABLE_BROWSER !== "1") {
      throw new Error("browser provider disabled: set WEBFETCH_ENABLE_BROWSER=1");
    }
    await getBucket("browser").take();

    let chromium: any;
    try {
      // @ts-expect-error optional peer; not bundled
      ({ chromium } = (await import("playwright")) as any);
    } catch {
      throw new Error("playwright not installed; run `bun add -d playwright` to enable browser provider");
    }

    const browserInstance = await chromium.launch({ headless: true });
    try {
      const ctx = await browserInstance.newContext({
        userAgent:
          opts.auth?.userAgent ??
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      });
      const page = await ctx.newPage();
      const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&safe=${opts.safeSearch === "off" ? "off" : "active"}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 15000 });
      // Collect <img src> elements that have reasonable dimensions.
      const hits: { src: string; title?: string; pageUrl?: string }[] = await page.evaluate((limit: number) => {
        const imgs = Array.from(document.querySelectorAll("img"))
          .filter((i: any) => (i.naturalWidth ?? 0) > 120 && i.src?.startsWith("http"))
          .slice(0, limit);
        return imgs.map((i: any) => ({
          src: i.src,
          title: i.alt,
          pageUrl: i.closest("a")?.href,
        }));
      }, opts.maxPerProvider ?? 10);

      return hits.map((h) => {
        const heur = heuristicLicenseFromUrl(h.src);
        return {
          url: h.src,
          source: "browser" as const,
          sourcePageUrl: h.pageUrl,
          title: h.title,
          license: heur.license,
          confidence: heur.confidence,
          viaBrowserFallback: true,
        } as ImageCandidate;
      });
    } finally {
      await browserInstance.close();
    }
  },
};
