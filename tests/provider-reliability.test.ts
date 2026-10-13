/**
 * Provider reliability regressions:
 *  - per-provider timeout is enforced even when a fetcher ignores AbortSignal
 *  - Wikimedia / MusicBrainz / health checks send a policy-compliant User-Agent
 *  - retired endpoints (Burst JSON, Bing v7) fail with a clear reason and
 *    Burst no longer runs by default
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  ALL_PROVIDERS,
  DEFAULT_PROVIDERS,
  DEFAULT_USER_AGENT,
  _resetCircuitBreakers,
  _resetHealthCache,
  defaultUserAgent,
  healthCheckProvider,
  searchImages,
} from "../packages/core/src/index.ts";
import { PROVIDER_ENDPOINTS } from "../packages/core/src/provider-health-check.ts";

const hang = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;

function capture(response: () => Response) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return response();
  }) as unknown as typeof fetch;
  return { seen, fetcher };
}

const ua = (init?: RequestInit) => new Headers(init?.headers).get("user-agent") ?? "";

afterEach(() => {
  _resetHealthCache();
  _resetCircuitBreakers();
  delete process.env.WEBFETCH_USER_AGENT;
});

describe("per-provider timeout", () => {
  test("a fetcher that ignores the abort signal cannot hang the search", async () => {
    const started = Date.now();
    const out = await searchImages("x", {
      providers: ["openverse"],
      timeoutMs: 500,
      fetcher: hang,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(3_000);
    const r = out.providerReports.find((p) => p.provider === "openverse")!;
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("timeout");
    expect(r.error).toContain("timed out after");
  });

  test("a hung provider does not block results from healthy ones", async () => {
    const fetcher = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("openverse")) return hang(url, init);
      return new Response(JSON.stringify({ collection: { items: [] } }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const out = await searchImages("x", {
      providers: ["openverse", "nasa"],
      timeoutMs: 500,
      fetcher,
    });
    expect(out.providerReports.find((p) => p.provider === "nasa")?.ok).toBe(true);
    expect(out.providerReports.find((p) => p.provider === "openverse")?.errorKind).toBe("timeout");
  });

  test("spotify token request receives the abort signal", async () => {
    const { seen, fetcher } = capture(() => new Response("{}", { status: 500 }));
    const ctl = new AbortController();
    await ALL_PROVIDERS.spotify
      .search("x", {
        fetcher,
        signal: ctl.signal,
        auth: { spotifyClientId: "a", spotifyClientSecret: "b" },
      })
      .catch(() => {});
    const token = seen.find((s) => s.url.includes("accounts.spotify.com"));
    expect(token?.init?.signal).toBe(ctl.signal);
  });
});

describe("User-Agent", () => {
  test("default UA identifies the project with a contact URL", () => {
    expect(DEFAULT_USER_AGENT).toContain("https://github.com/ashlrai/webfetch");
    expect(defaultUserAgent({ WEBFETCH_USER_AGENT: "me/1 (+mailto:x@y)" })).toBe(
      "me/1 (+mailto:x@y)",
    );
  });

  test("wikimedia and musicbrainz send it by default", async () => {
    for (const id of ["wikimedia", "musicbrainz-caa"] as const) {
      const { seen, fetcher } = capture(
        () => new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }),
      );
      await ALL_PROVIDERS[id].search("cat", { fetcher }).catch(() => {});
      expect(seen.length).toBeGreaterThan(0);
      expect(ua(seen[0]!.init), id).toContain("github.com/ashlrai/webfetch");
    }
  });

  test("WEBFETCH_USER_AGENT overrides it", async () => {
    process.env.WEBFETCH_USER_AGENT = "custom/1 (+https://example.com)";
    const { seen, fetcher } = capture(
      () => new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    await ALL_PROVIDERS.wikimedia.search("cat", { fetcher }).catch(() => {});
    expect(ua(seen[0]!.init)).toBe("custom/1 (+https://example.com)");
  });

  test("health checks use it and a valid wikimedia query", async () => {
    expect(PROVIDER_ENDPOINTS.wikimedia).toContain("srsearch=");
    expect(PROVIDER_ENDPOINTS.wikimedia).not.toContain("gsrsearch=");
    const { seen, fetcher } = capture(
      () => new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    await healthCheckProvider("wikimedia", { fetcher, noCache: true });
    expect(ua(seen[0]!.init)).toContain("github.com/ashlrai/webfetch");
  });
});

describe("retired endpoints", () => {
  test("burst is opt-in and not a default provider", () => {
    expect(ALL_PROVIDERS.burst.optIn).toBe(true);
    expect(DEFAULT_PROVIDERS).not.toContain("burst");
  });

  test("burst 406 explains the retirement", async () => {
    const { fetcher } = capture(() => new Response("{}", { status: 406 }));
    await expect(ALL_PROVIDERS.burst.search("desk", { fetcher })).rejects.toThrow(
      /appears retired/,
    );
  });

  test("bing 410 explains the retirement and suggests alternatives", async () => {
    const { fetcher } = capture(() => new Response("", { status: 410 }));
    await expect(
      ALL_PROVIDERS.bing.search("x", { fetcher, auth: { bingApiKey: "k" } }),
    ).rejects.toThrow(/retired the Bing Search APIs.*brave or serpapi/);
  });
});
