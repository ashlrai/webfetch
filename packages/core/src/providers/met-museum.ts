/**
 * The Metropolitan Museum of Art — Open Access (CC0) collection.
 * No auth. Two-step: /search for objectIDs, then /objects/{id} for detail.
 * We filter to `isPublicDomain: true`.
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const metMuseum: Provider = {
  id: "met-museum",
  defaultLicense: "CC0",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("met-museum").take();
    const fetcher = opts.fetcher ?? fetch;
    const searchUrl =
      "https://collectionapi.metmuseum.org/public/collection/v1/search?" +
      new URLSearchParams({ q: query, hasImages: "true" });

    const sResp = await fetcher(searchUrl, { signal: opts.signal });
    if (!sResp.ok) throw new Error(`met-museum http ${sResp.status}`);
    const sJson = (await sResp.json()) as any;
    const ids: number[] = (sJson.objectIDs ?? []).slice(0, opts.maxPerProvider ?? 10);

    const out: ImageCandidate[] = [];
    for (const id of ids) {
      await getBucket("met-museum").take();
      try {
        const dResp = await fetcher(
          `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
          { signal: opts.signal },
        );
        if (!dResp.ok) continue;
        const d = (await dResp.json()) as any;
        if (!d.isPublicDomain || !d.primaryImage) continue;
        out.push({
          url: d.primaryImage,
          thumbnailUrl: d.primaryImageSmall,
          source: "met-museum",
          sourcePageUrl: d.objectURL,
          title: d.title,
          author: d.artistDisplayName,
          license: "CC0",
          licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
          confidence: 0.95,
        });
      } catch {
        // skip this id
      }
    }
    return out;
  },
};
