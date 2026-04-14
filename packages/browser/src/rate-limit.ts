/**
 * Per-process token bucket for browser calls. Default 10 per minute.
 * Caller-tunable via BrowserOptions.rateLimitPerMin. Browser calls are
 * expensive (and noisy to targets); we stay conservative.
 */

export interface BrowserBucket {
  tryTake(): boolean;
  take(): Promise<void>;
}

export function createBrowserBucket(perMin: number): BrowserBucket {
  const capacity = Math.max(1, perMin);
  const refillRate = perMin / 60_000; // tokens per ms
  let tokens = capacity;
  let lastRefill = Date.now();

  const refill = () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + (now - lastRefill) * refillRate);
    lastRefill = now;
  };

  return {
    tryTake(): boolean {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      return false;
    },
    async take(): Promise<void> {
      refill();
      while (tokens < 1) {
        const need = 1 - tokens;
        const waitMs = Math.max(1, Math.ceil(need / refillRate));
        await new Promise((r) => setTimeout(r, waitMs));
        refill();
      }
      tokens -= 1;
    },
  };
}
