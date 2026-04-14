/**
 * Bright Data Scraping Browser adapter. Connects to Bright Data's hosted
 * browser via Chrome DevTools Protocol websocket. They handle stealth,
 * proxy rotation, and captcha on their side.
 *
 * Expected env / credentials (either form works):
 *   BRIGHTDATA_WS_ENDPOINT="wss://brd-customer-<cust>-zone-<zone>:<pass>@brd.superproxy.io:9222"
 *   — OR —
 *   BRIGHTDATA_CUSTOMER=<cust>
 *   BRIGHTDATA_PASSWORD=<pass>
 *   BRIGHTDATA_ZONE=<zone-name>     (default: "scraping_browser")
 */

import { BrowserDependencyError, type BrowserOptions, type StackId } from "../types.ts";
import type { Stack, StackSession } from "./contract.ts";

const STACK_ID: StackId = "brightdata";

export function buildBrightdataWsEndpoint(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BRIGHTDATA_WS_ENDPOINT) return env.BRIGHTDATA_WS_ENDPOINT;
  const cust = env.BRIGHTDATA_CUSTOMER;
  const pass = env.BRIGHTDATA_PASSWORD;
  const zone = env.BRIGHTDATA_ZONE ?? "scraping_browser";
  if (!cust || !pass) return null;
  return `wss://brd-customer-${cust}-zone-${zone}:${pass}@brd.superproxy.io:9222`;
}

async function loadPlaywright(): Promise<any> {
  try {
    // @ts-expect-error optional peer; not bundled
    return await import("playwright");
  } catch {
    throw new BrowserDependencyError("playwright", STACK_ID);
  }
}

export const brightdataStack: Stack = {
  id: STACK_ID,
  async open(_opts: BrowserOptions): Promise<StackSession> {
    const ws = buildBrightdataWsEndpoint();
    if (!ws) {
      throw new Error(
        "brightdata stack selected but BRIGHTDATA_WS_ENDPOINT / BRIGHTDATA_CUSTOMER+BRIGHTDATA_PASSWORD not set",
      );
    }
    const { chromium } = await loadPlaywright();
    const browser = await chromium.connectOverCDP(ws);
    const context =
      browser.contexts()[0] ?? (await browser.newContext());
    return {
      stack: STACK_ID,
      async newPage() {
        return context.newPage();
      },
      async close() {
        await browser.close().catch(() => undefined);
      },
    };
  },
};
