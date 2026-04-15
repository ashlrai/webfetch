/**
 * Rebrowser-Playwright stack (default self-hosted). Actively-patched fork of
 * Playwright that removes the `runtime.enable` side-channel detection without
 * needing a plugin. Drop-in replacement for playwright.
 */

import { randomFingerprint } from "../fingerprint.ts";
import { formatProxy } from "../proxy.ts";
import { BrowserDependencyError, type BrowserOptions, type StackId } from "../types.ts";
import type { Stack, StackSession } from "./contract.ts";

const STACK_ID: StackId = "rebrowser";

async function loadRebrowser(): Promise<any> {
  try {
    // @ts-expect-error optional peer; not bundled
    return await import("rebrowser-playwright");
  } catch {
    throw new BrowserDependencyError("rebrowser-playwright", STACK_ID);
  }
}

export const rebrowserStack: Stack = {
  id: STACK_ID,
  async open(opts: BrowserOptions): Promise<StackSession> {
    const { chromium } = await loadRebrowser();
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
