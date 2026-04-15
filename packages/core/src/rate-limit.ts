/**
 * Per-provider token-bucket rate limiter. Copied-pattern from
 * artist-encyclopedia-factory/packages/ingest/src/rate-limit.ts.
 * Intentionally conservative — we stay well below documented ceilings so a
 * parallel fleet of agents doesn't trip 429s.
 */

import type { ProviderId } from "./types.ts";

interface Bucket {
  capacity: number;
  tokens: number;
  refillRate: number; // tokens per ms
  lastRefill: number;
}

const DEFAULTS: Record<ProviderId, { capacity: number; perSec: number }> = {
  wikimedia: { capacity: 20, perSec: 20 },
  openverse: { capacity: 5, perSec: 5 },
  unsplash: { capacity: 1, perSec: 1 }, // 50/hr demo key; be conservative
  pexels: { capacity: 3, perSec: 3 },
  pixabay: { capacity: 2, perSec: 2 },
  itunes: { capacity: 5, perSec: 5 },
  "musicbrainz-caa": { capacity: 1, perSec: 1 },
  spotify: { capacity: 10, perSec: 10 },
  "youtube-thumb": { capacity: 20, perSec: 20 },
  brave: { capacity: 1, perSec: 1 },
  bing: { capacity: 3, perSec: 3 },
  serpapi: { capacity: 2, perSec: 2 },
  browser: { capacity: 1, perSec: 0.25 }, // never hammer headless browser
  flickr: { capacity: 3, perSec: 3 }, // 3600/hr — keep generous headroom
  "internet-archive": { capacity: 5, perSec: 5 },
  smithsonian: { capacity: 2, perSec: 1 }, // DEMO_KEY: 30/hr — conservative
  nasa: { capacity: 5, perSec: 5 }, // no documented hard cap
  "met-museum": { capacity: 4, perSec: 4 }, // ~80/sec — stay low
  europeana: { capacity: 5, perSec: 5 },
  "library-of-congress": { capacity: 10, perSec: 10 },
  "wellcome-collection": { capacity: 5, perSec: 5 },
  rawpixel: { capacity: 3, perSec: 3 },
  burst: { capacity: 3, perSec: 3 },
  "europeana-archival": { capacity: 5, perSec: 5 },
};

const buckets = new Map<ProviderId, Bucket>();

export function getBucket(p: ProviderId) {
  let b = buckets.get(p);
  if (!b) {
    const d = DEFAULTS[p];
    b = { capacity: d.capacity, tokens: d.capacity, refillRate: d.perSec / 1000, lastRefill: Date.now() };
    buckets.set(p, b);
  }
  const bucket = b;
  const refill = () => {
    const now = Date.now();
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + (now - bucket.lastRefill) * bucket.refillRate);
    bucket.lastRefill = now;
  };
  return {
    tryTake(): boolean {
      refill();
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
      }
      return false;
    },
    async take(): Promise<void> {
      refill();
      while (bucket.tokens < 1) {
        const need = 1 - bucket.tokens;
        const waitMs = Math.max(1, Math.ceil(need / bucket.refillRate));
        await new Promise((r) => setTimeout(r, waitMs));
        refill();
      }
      bucket.tokens -= 1;
    },
  };
}

export function _resetBuckets(): void {
  buckets.clear();
}
