/**
 * Smoke tests for @webfetch/server — auth, CORS, and a happy-path provider listing.
 *
 * These intentionally avoid hitting real provider APIs. The /providers endpoint
 * is static metadata; /search etc. are exercised through their schema layer
 * with no network.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer } from "../packages/server/src/server.ts";
import { isOriginAllowed } from "../packages/server/src/cors.ts";

const TOKEN = "t".repeat(64);
let server: ReturnType<typeof startServer>;
let base: string;

beforeAll(() => {
  // Port 0 → OS picks a free port; Bun.serve honors that.
  server = startServer({ port: 0, token: TOKEN });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => { try { server.stop(true); } catch {} });

describe("auth", () => {
  test("401 when no Authorization header", async () => {
    const r = await fetch(`${base}/providers`);
    expect(r.status).toBe(401);
    const j = await r.json() as any;
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
    const j = await r.json() as any;
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.data.all)).toBe(true);
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
});
