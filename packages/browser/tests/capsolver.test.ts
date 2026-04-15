import { describe, expect, it } from "bun:test";

import { detectCaptcha, solveCaptcha } from "../src/index.ts";

describe("detectCaptcha", () => {
  it("detects Turnstile widget", () => {
    const c = detectCaptcha(
      '<div class="cf-turnstile" data-sitekey="0xABC123"></div>',
      "https://example.com",
    );
    expect(c?.type).toBe("turnstile");
    expect(c?.siteKey).toBe("0xABC123");
  });

  it("detects reCAPTCHA v2", () => {
    const c = detectCaptcha(
      '<div class="g-recaptcha" data-sitekey="6Lc_abcXYZ"></div>',
      "https://example.com",
    );
    expect(c?.type).toBe("recaptcha-v2");
  });

  it("detects reCAPTCHA v3 script", () => {
    const c = detectCaptcha(
      '<script src="https://www.google.com/recaptcha/api.js?render=6Lc_v3key_A-B"></script>',
      "https://example.com",
    );
    expect(c?.type).toBe("recaptcha-v3");
    expect(c?.siteKey).toBe("6Lc_v3key_A-B");
  });

  it("returns null on clean HTML", () => {
    expect(detectCaptcha("<html><body>no captcha</body></html>", "https://x.com")).toBeNull();
  });
});

describe("solveCaptcha (stubbed HTTP)", () => {
  it("creates a task, polls, and returns the token", async () => {
    const calls: string[] = [];
    let pollCount = 0;

    const fetcher: typeof fetch = (async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/createTask")) {
        return new Response(JSON.stringify({ errorId: 0, taskId: "task-1" }), {
          status: 200,
        });
      }
      if (u.endsWith("/getTaskResult")) {
        pollCount++;
        if (pollCount < 2) {
          return new Response(JSON.stringify({ errorId: 0, status: "processing" }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            errorId: 0,
            status: "ready",
            solution: { gRecaptchaResponse: "token-xyz" },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const solution = await solveCaptcha(
      { kind: "capsolver", apiKey: "client-k" },
      { type: "recaptcha-v2", siteKey: "sk", pageUrl: "https://x.com" },
      {
        fetcher,
        pollIntervalMs: 0,
        maxWaitMs: 10_000,
        sleep: async () => undefined,
        now: (() => {
          let t = 0;
          return () => {
            t += 10;
            return t;
          };
        })(),
      },
    );

    expect(solution.token).toBe("token-xyz");
    expect(calls[0]).toMatch(/createTask$/);
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  it("throws on createTask error", async () => {
    const fetcher = (async () => {
      return new Response(
        JSON.stringify({ errorId: 1, errorCode: "BAD_KEY", errorDescription: "bad" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await expect(
      solveCaptcha(
        { kind: "capsolver", apiKey: "client-k" },
        { type: "recaptcha-v2", siteKey: "sk", pageUrl: "https://x.com" },
        { fetcher, sleep: async () => undefined },
      ),
    ).rejects.toThrow(/bad/);
  });
});
