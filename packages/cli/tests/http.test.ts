import { afterEach, describe, expect, test } from "bun:test";
import type { ResolvedConfig } from "../src/config.ts";
import { cloudRequest } from "../src/http.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function cfg(overrides: ResolvedConfig = {}): ResolvedConfig {
  return {
    apiKey: "wf_test",
    baseUrl: "https://api.example.test",
    ...overrides,
  };
}

function mockFetch(response: Response, requests: Request[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    requests.push(req);
    return response;
  }) as typeof fetch;
}

describe("cloudRequest", () => {
  test("unwraps API envelope data", async () => {
    const requests: Request[] = [];
    mockFetch(
      new Response(JSON.stringify({ ok: true, data: { value: 42 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      requests,
    );

    await expect(cloudRequest(cfg(), "/search", { body: { query: "x" } })).resolves.toEqual({
      value: 42,
    });
  });

  test("throws API error payload even when HTTP status is ok", async () => {
    const requests: Request[] = [];
    mockFetch(
      new Response(JSON.stringify({ ok: false, error: "bad request" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      requests,
    );

    await expect(cloudRequest(cfg(), "/search", { body: { query: "x" } })).rejects.toThrow(
      "bad request",
    );
  });

  test("throws message payload for non-ok HTTP responses", async () => {
    const requests: Request[] = [];
    mockFetch(
      new Response(JSON.stringify({ message: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
      requests,
    );

    await expect(cloudRequest(cfg(), "/search", { body: { query: "x" } })).rejects.toThrow(
      "unauthorized",
    );
  });

  test("falls back to HTTP status when error response is invalid JSON", async () => {
    const requests: Request[] = [];
    mockFetch(
      new Response("not json", {
        status: 502,
        headers: { "content-type": "text/plain" },
      }),
      requests,
    );

    await expect(cloudRequest(cfg(), "/search", { body: { query: "x" } })).rejects.toThrow(
      "cloud http 502",
    );
  });

  test("normalizes trailing slashes on base URL", async () => {
    const requests: Request[] = [];
    mockFetch(new Response(JSON.stringify({ ok: true, data: "ok" }), { status: 200 }), requests);

    await cloudRequest(cfg({ baseUrl: "https://api.example.test///" }), "/providers", {
      method: "GET",
    });

    expect(requests[0]!.url).toBe("https://api.example.test/v1/providers");
  });

  test("requires an API key before issuing a request", async () => {
    const requests: Request[] = [];
    mockFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }), requests);

    await expect(cloudRequest(cfg({ apiKey: undefined }), "/search")).rejects.toThrow(
      "cloud mode requires WEBFETCH_API_KEY or config set apiKey <key>",
    );
    expect(requests).toHaveLength(0);
  });

  test("POST sends JSON body and content type by default", async () => {
    const requests: Request[] = [];
    mockFetch(new Response(JSON.stringify({ ok: true, data: "ok" }), { status: 200 }), requests);

    await cloudRequest(cfg(), "/search", { body: { query: "cloud query" } });

    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.headers.get("accept")).toBe("application/json");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer wf_test");
    expect(requests[0]!.headers.get("content-type")).toBe("application/json");
    await expect(requests[0]!.json()).resolves.toEqual({ query: "cloud query" });
  });

  test("GET sends no body and no content type", async () => {
    const requests: Request[] = [];
    mockFetch(
      new Response(JSON.stringify({ ok: true, data: ["wikimedia"] }), { status: 200 }),
      requests,
    );

    await cloudRequest(cfg(), "/providers", { method: "GET" });

    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer wf_test");
    expect(requests[0]!.headers.get("content-type")).toBeNull();
    await expect(requests[0]!.text()).resolves.toBe("");
  });
});
