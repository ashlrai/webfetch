/**
 * Vanilla Playwright stack. Minimal stealth — just fingerprint randomization.
 * Good for dev + CI fixtures; use rebrowser or brightdata for production.
 *
 * All playwright imports are lazy so installs without it still work.
 */

import { randomFingerprint } from "../fingerprint.ts";
import { formatProxy } from "../proxy.ts";
import { BrowserDependencyError, type BrowserOptions, type StackId } from "../types.ts";
import type { Stack, StackSession } from "./contract.ts";

const STACK_ID: StackId = "vanilla";

async function loadPlaywright(): Promise<any> {
  try {
    // @ts-expect-error optional peer; not bundled
    return await import("playwright");
  } catch {
    throw new BrowserDependencyError("playwright", STACK_ID);
  }
}

export const vanillaStack: Stack = {
  id: STACK_ID,
  async open(opts: BrowserOptions): Promise<StackSession> {
    const { chromium } = await loadPlaywright();
    const fp = randomFingerprint();
    const launchOpts: Record<string, unknown> = {
      headless: opts.headless ?? true,
    };
    if (opts.proxy) {
      const p = formatProxy(opts.proxy);
      launchOpts.proxy = {
        server: p.server,
        username: p.username,
        password: p.password,
      };
    }
    const browser = await chromium.launch(launchOpts);
    const context = await browser.newContext({
      userAgent: fp.userAgent,
      viewport: fp.viewport,
      locale: fp.locale,
      timezoneId: fp.timezoneId,
    });
    return {
      stack: STACK_ID,
      async newPage() {
        return context.newPage();
      },
      async close() {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      },
    };
  },
};
