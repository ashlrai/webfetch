/**
 * CapSolver API client. Docs: https://docs.capsolver.com/
 *
 * Flow:
 *   1. POST /createTask  → { taskId }
 *   2. POST /getTaskResult (poll every 1.5s, up to timeout) → { status, solution }
 *
 * We accept an injectable fetcher for testability.
 */

import type { CaptchaConfig } from "../types.ts";
import type { CaptchaChallenge, CaptchaSolution } from "./types.ts";
import { CaptchaError } from "./types.ts";

const DEFAULT_BASE = "https://api.capsolver.com";

export interface CapsolverDeps {
  fetcher?: typeof fetch;
  /** Override the poll interval for tests. */
  pollIntervalMs?: number;
  /** Override total wait for tests. */
  maxWaitMs?: number;
  /** Injectable time for tests. */
  now?: () => number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

function challengeToTask(challenge: CaptchaChallenge): Record<string, unknown> {
  switch (challenge.type) {
    case "recaptcha-v2":
      return {
        type: "ReCaptchaV2TaskProxyLess",
        websiteURL: challenge.pageUrl,
        websiteKey: challenge.siteKey,
      };
    case "recaptcha-v3":
      return {
        type: "ReCaptchaV3TaskProxyLess",
        websiteURL: challenge.pageUrl,
        websiteKey: challenge.siteKey,
        pageAction: challenge.action ?? "verify",
        minScore: challenge.minScore ?? 0.7,
      };
    case "turnstile":
      return {
        type: "AntiTurnstileTaskProxyLess",
        websiteURL: challenge.pageUrl,
        websiteKey: challenge.siteKey,
      };
    case "hcaptcha":
      return {
        type: "HCaptchaTaskProxyLess",
        websiteURL: challenge.pageUrl,
        websiteKey: challenge.siteKey,
      };
  }
}

export async function solveCaptcha(
  cfg: CaptchaConfig,
  challenge: CaptchaChallenge,
  deps: CapsolverDeps = {},
): Promise<CaptchaSolution> {
  const fetcher = deps.fetcher ?? fetch;
  const base = cfg.baseUrl ?? DEFAULT_BASE;
  const pollIntervalMs = deps.pollIntervalMs ?? 1500;
  const maxWaitMs = deps.maxWaitMs ?? 120_000;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const startedAt = now();

  const createRes = await fetcher(`${base}/createTask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientKey: cfg.apiKey,
      task: challengeToTask(challenge),
    }),
  });
  if (!createRes.ok) {
    throw new CaptchaError("create_task_http", `capsolver createTask HTTP ${createRes.status}`);
  }
  const createJson = (await createRes.json()) as {
    errorId?: number;
    errorCode?: string;
    errorDescription?: string;
    taskId?: string;
  };
  if (createJson.errorId && createJson.errorId !== 0) {
    throw new CaptchaError(
      createJson.errorCode ?? "create_task_err",
      createJson.errorDescription ?? "capsolver createTask failed",
    );
  }
  if (!createJson.taskId) {
    throw new CaptchaError("no_task_id", "capsolver returned no taskId");
  }

  while (true) {
    if (now() - startedAt > maxWaitMs) {
      throw new CaptchaError("timeout", "capsolver polling timeout");
    }
    await sleep(pollIntervalMs);
    const pollRes = await fetcher(`${base}/getTaskResult`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientKey: cfg.apiKey,
        taskId: createJson.taskId,
      }),
    });
    if (!pollRes.ok) {
      throw new CaptchaError("poll_http", `capsolver getTaskResult HTTP ${pollRes.status}`);
    }
    const pj = (await pollRes.json()) as {
      errorId?: number;
      errorCode?: string;
      errorDescription?: string;
      status?: "processing" | "ready";
      solution?: { gRecaptchaResponse?: string; token?: string };
    };
    if (pj.errorId && pj.errorId !== 0) {
      throw new CaptchaError(
        pj.errorCode ?? "poll_err",
        pj.errorDescription ?? "capsolver getTaskResult failed",
      );
    }
    if (pj.status === "ready") {
      const token = pj.solution?.gRecaptchaResponse ?? pj.solution?.token;
      if (!token) {
        throw new CaptchaError("no_token", "capsolver reported ready but returned no token");
      }
      return { token, solvedInMs: now() - startedAt };
    }
  }
}

/**
 * Heuristic: scan a DOM snapshot / HTML for captcha markers. Returns the
 * first challenge found, or null.
 */
export function detectCaptcha(html: string, pageUrl: string): CaptchaChallenge | null {
  // Turnstile
  const ts = html.match(
    /<[^>]+class=["'][^"']*cf-turnstile[^"']*["'][^>]*data-sitekey=["']([^"']+)["']/i,
  );
  if (ts?.[1]) {
    return { type: "turnstile", siteKey: ts[1], pageUrl };
  }
  // reCAPTCHA v2
  const rc2 = html.match(
    /<[^>]+class=["'][^"']*g-recaptcha[^"']*["'][^>]*data-sitekey=["']([^"']+)["']/i,
  );
  if (rc2?.[1]) {
    return { type: "recaptcha-v2", siteKey: rc2[1], pageUrl };
  }
  // reCAPTCHA v3 script
  const rc3 = html.match(/recaptcha\/api\.js\?render=([a-zA-Z0-9_-]+)/);
  if (rc3?.[1]) {
    return { type: "recaptcha-v3", siteKey: rc3[1], pageUrl };
  }
  // hCaptcha
  const hc = html.match(
    /<[^>]+class=["'][^"']*h-captcha[^"']*["'][^>]*data-sitekey=["']([^"']+)["']/i,
  );
  if (hc?.[1]) {
    return { type: "hcaptcha", siteKey: hc[1], pageUrl };
  }
  return null;
}
