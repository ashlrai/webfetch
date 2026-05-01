/**
 * Unit tests for the managed-browser provider (Bright Data Web Unlocker fallback).
 *
 * The provider is the moat for the paid tiers — when 19+ licensed providers all
 * miss, this fetches Google Images / Pinterest via Bright Data's Web Unlocker
 * REST endpoint and returns license: UNKNOWN candidates so Pro+ users still
 * get *something* back.
 */

import { describe, expect, test } from "bun:test";
import { managedBrowser } from "../packages/core/src/providers/managed-browser.ts";
import { stubFetcher, textResponse } from "./stub-fetcher.ts";

const GOOGLE_HTML = `
<!doctype html><html><body>
<a href="https://example.com/post/1"><img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:abc" alt="A photo" width="300" height="200"></a>
<a href="https://example.com/post/2"><img src="https://encrypted-tbn1.gstatic.com/images?q=tbn:def" alt="Another"></a>
<img src="https://www.google.com/images/branding/spinner.svg">
<img src="https://www.google.com/images/sprite.png">
</body></html>`;

const PINTEREST_HTML = `
<!doctype html><html><body>
<a href="/pin/12345/"><img src="https://i.pinimg.com/736x/aa/bb/cc/abc.jpg" alt="Pin" width="736" height="491"></a>
<a href="/pin/67890/"><img src="https://i.pinimg.com/originals/dd/ee/ff/def.png" alt=""></a>
</body></html>`;

describe("managed-browser provider (Bright Data)", () => {
  test("returns [] when brightDataApiToken missing", async () => {
    const fetcher = stubFetcher([
      {
        match: () => true,
        handler: async () => textResponse(GOOGLE_HTML),
      },
    ]);
    const out = await managedBrowser.search("anything", { fetcher });
    expect(out).toEqual([]);
  });

  test("hits brightdata.com/request with correct auth + body for both Google and Pinterest", async () => {
    const calls: { url: string; body: any; auth: string | null }[] = [];
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.brightdata.com/request"),
        handler: async (url, init) => {
          calls.push({
            url,
            body: JSON.parse(String(init?.body ?? "{}")),
            auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null,
          });
          // Two different responses based on which target URL we're proxying.
          const targetUrl = JSON.parse(String(init?.body ?? "{}")).url as string;
          if (targetUrl.includes("google.com")) return textResponse(GOOGLE_HTML);
          if (targetUrl.includes("pinterest.com")) return textResponse(PINTEREST_HTML);
          return textResponse("");
        },
      },
    ]);
    const out = await managedBrowser.search("drake portrait", {
      fetcher,
      auth: { brightDataApiToken: "test_api_token_abc123" },
      maxPerProvider: 10,
    });

    expect(calls.length).toBe(2);
    expect(calls[0]!.auth).toBe("Bearer test_api_token_abc123");
    expect(calls[0]!.body.zone).toBe("web_unlocker");
    expect(calls[0]!.body.format).toBe("raw");
    expect(calls[0]!.body.url).toContain("google.com/search?tbm=isch");
    expect(calls[0]!.body.url).toContain("drake");
    expect(calls[1]!.body.url).toContain("pinterest.com/search/pins");

    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.license).toBe("UNKNOWN");
      expect(c.viaBrowserFallback).toBe(true);
      expect(c.confidence).toBe(0);
      expect(c.source).toBe("managed-browser");
      expect(c.attributionLine).toContain("Bright Data");
    }
  });

  test("respects custom brightDataZone", async () => {
    let observedZone: string | null = null;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.brightdata.com/request"),
        handler: async (_, init) => {
          observedZone = JSON.parse(String(init?.body ?? "{}")).zone;
          return textResponse(GOOGLE_HTML);
        },
      },
    ]);
    await managedBrowser.search("query", {
      fetcher,
      auth: {
        brightDataApiToken: "tok_test",
        brightDataZone: "my_custom_zone",
      },
    });
    expect(observedZone).toBe("my_custom_zone");
  });

  test("filters out spinner / sprite / svg garbage", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.brightdata.com/request"),
        handler: async () => textResponse(GOOGLE_HTML),
      },
    ]);
    const out = await managedBrowser.search("query", {
      fetcher,
      auth: { brightDataApiToken: "tok_test" },
    });
    for (const c of out) {
      expect(c.url).not.toContain("spinner");
      expect(c.url).not.toContain("sprite");
      expect(c.url.endsWith(".svg")).toBe(false);
    }
  });

  test("gracefully handles upstream HTTP errors (returns [])", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.brightdata.com/request"),
        handler: async () => new Response("upstream blocked", { status: 502 }),
      },
    ]);
    const out = await managedBrowser.search("query", {
      fetcher,
      auth: { brightDataApiToken: "tok_test" },
    });
    expect(out).toEqual([]);
  });

  test("respects maxPerProvider cap", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.brightdata.com/request"),
        handler: async (_, init) => {
          const targetUrl = JSON.parse(String(init?.body ?? "{}")).url as string;
          if (targetUrl.includes("google.com")) return textResponse(GOOGLE_HTML);
          return textResponse(PINTEREST_HTML);
        },
      },
    ]);
    const out = await managedBrowser.search("query", {
      fetcher,
      auth: { brightDataApiToken: "tok_test" },
      maxPerProvider: 1,
    });
    expect(out.length).toBe(1);
  });
});
