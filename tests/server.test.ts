/**
 * Smoke tests for @webfetch/server — auth, CORS, and a happy-path provider listing.
 *
 * These intentionally avoid hitting real provider APIs. The /providers endpoint
 * is static metadata; /search etc. are exercised through their schema layer
 * with no network.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isOriginAllowed } from "../packages/server/src/cors.ts";
import { startServer } from "../packages/server/src/server.ts";

const TOKEN = "t".repeat(64);
let server: ReturnType<typeof startServer> | undefined;
let base: string;

beforeAll(async () => {
  server = await startTestServer();
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => {
  try {
    server?.stop(true);
  } catch {}
});

async function startTestServer() {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    const port = testPort(attempt);
    try {
      return startServer({ port, token: TOKEN });
    } catch (err) {
      lastError = err;
      if (!String(err).includes("port")) break;
    }
  }

  throw lastError ?? new Error("Failed to start test server");
}

function testPort(attempt: number): number {
  const base = 30_000 + (process.pid % 20_000);
  return base + attempt;
}

describe("auth", () => {
  test("401 when no Authorization header", async () => {
    const r = await fetch(`${base}/providers`);
    expect(r.status).toBe(401);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(false);
  });

  test("401 with wrong token", async () => {
    const r = await fetch(`${base}/providers`, {
      headers: { authorization: "Bearer wrong" },
    });
    expect(r.status).toBe(401);
  });

  test("200 with correct token on /providers", async () => {
    const r = await fetch(`${base}/providers`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.data.all)).toBe(true);
    expect(j.data.all).toContain("wikimedia");
  });

  test("200 with correct token on compatibility /v1/providers", async () => {
    const r = await fetch(`${base}/v1/providers`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(j.data.all).toContain("wikimedia");
  });

  test("200 on /health with correct token", async () => {
    const r = await fetch(`${base}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
  });
});

describe("CORS", () => {
  test("allows chrome-extension origin", () => {
    expect(isOriginAllowed("chrome-extension://abc123")).toBe(true);
  });
  test("allows localhost / 127.0.0.1", () => {
    expect(isOriginAllowed("http://127.0.0.1:5173")).toBe(true);
    expect(isOriginAllowed("http://localhost:3000")).toBe(true);
  });
  test("rejects foreign https origin", () => {
    expect(isOriginAllowed("https://evil.example.com")).toBe(false);
  });
  test("403 when request comes from forbidden origin", async () => {
    const r = await fetch(`${base}/providers`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        origin: "https://evil.example.com",
      },
    });
    expect(r.status).toBe(403);
  });

  test("OPTIONS preflight 204 for allowed origin", async () => {
    const r = await fetch(`${base}/search`, {
      method: "OPTIONS",
      headers: { origin: "chrome-extension://abc", "access-control-request-method": "POST" },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("chrome-extension://abc");
  });
});

describe("auth-display", () => {
  test("GET /auth/display returns HTML without Bearer", async () => {
    const r = await fetch(`${base}/auth/display`);
    expect(r.status).toBe(200);
    const ct = r.headers.get("content-type") ?? "";
    expect(ct.includes("text/html")).toBe(true);
    const body = await r.text();
    expect(body).toContain(TOKEN);
    expect(body).toContain("Copy token");
  });

  test("GET /auth/display is unavailable when server binds non-loopback", async () => {
    const publicServer = startServer({ port: 0, hostname: "0.0.0.0", token: TOKEN });
    try {
      const r = await fetch(`http://127.0.0.1:${publicServer.port}/auth/display`);
      expect(r.status).toBe(404);
      const body = await r.text();
      expect(body).not.toContain(TOKEN);
    } finally {
      publicServer.stop(true);
    }
  });
});

describe("validation", () => {
  test("422 on malformed /search body", async () => {
    const r = await fetch(`${base}/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ notAQuery: true }),
    });
    expect(r.status).toBe(422);
  });

  test("POST /v1/search uses local compatibility path", async () => {
    const r = await fetch(`${base}/v1/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ notAQuery: true }),
    });
    expect(r.status).toBe(422);
  });

  test("blocks SSRF targets on /probe and /license", async () => {
    for (const path of ["/probe", "/license"]) {
      const r = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1/private" }),
      });
      expect(r.status).toBe(422);
      const j = (await r.json()) as any;
      expect(j.error).toContain("host blocked");
    }
  });
});
