/**
 * Camoufox stack — Firefox ESR with C++-level fingerprint spoofing. Heavier to
 * install (downloads a ~160MB Firefox build); use for hard targets.
 *
 * The camoufox npm package exposes a Playwright-compatible `launchPersistent`
 * / `launch` surface we consume here.
 */

import { formatProxy } from "../proxy.ts";
import { BrowserDependencyError, type BrowserOptions, type StackId } from "../types.ts";
import type { Stack, StackSession } from "./contract.ts";

const STACK_ID: StackId = "camoufox";

async function loadCamoufox(): Promise<any> {
  try {
    // @ts-expect-error optional peer; not bundled
    return await import("camoufox");
  } catch {
    throw new BrowserDependencyError("camoufox", STACK_ID);
  }
}

export const camoufoxStack: Stack = {
  id: STACK_ID,
  async open(opts: BrowserOptions): Promise<StackSession> {
    const camoufox: any = await loadCamoufox();
    const launchFn = camoufox.launch ?? camoufox.default?.launch;
    if (!launchFn) throw new BrowserDependencyError("camoufox", STACK_ID);
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
    const browser = await launchFn(launchOpts);
    const context = (await browser.newContext?.()) ?? (await browser.defaultContext?.());
    return {
      stack: STACK_ID,
      async newPage() {
        return context.newPage();
      },
      async close() {
        await context?.close?.().catch(() => undefined);
        await browser.close().catch(() => undefined);
      },
    };
  },
};
