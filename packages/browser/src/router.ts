/**
 * Hybrid router. Selects a stack given caller options + environment.
 *
 *   Precedence:
 *   1. opts.stack (explicit wins)
 *   2. BRIGHTDATA_WS_ENDPOINT or BRIGHTDATA_CUSTOMER+BRIGHTDATA_PASSWORD → brightdata
 *   3. rebrowser-playwright installed → rebrowser
 *   4. playwright installed → vanilla
 *   5. throws BrowserDependencyError
 *
 * We keep this logic detection-based (not network-call-based) so tests can
 * fully control behavior via env vars + a stub `hasModule` probe.
 */

import { brightdataStack, buildBrightdataWsEndpoint } from "./stacks/brightdata.ts";
import { camoufoxStack } from "./stacks/camoufox.ts";
import type { Stack } from "./stacks/contract.ts";
import { rebrowserStack } from "./stacks/rebrowser.ts";
import { vanillaStack } from "./stacks/vanilla.ts";
import { BrowserDependencyError, type BrowserOptions, type StackId } from "./types.ts";

export const STACKS: Record<StackId, Stack> = {
  vanilla: vanillaStack,
  rebrowser: rebrowserStack,
  camoufox: camoufoxStack,
  brightdata: brightdataStack,
};

export interface RouterEnv {
  env?: NodeJS.ProcessEnv;
  /**
   * Probe for optional peer deps. Default: dynamic import with a catch.
   * Tests pass a deterministic function.
   */
  hasModule?: (name: string) => Promise<boolean>;
}

async function defaultHasModule(name: string): Promise<boolean> {
  try {
    await import(name);
    return true;
  } catch {
    return false;
  }
}

export async function pickStack(opts: BrowserOptions, routerEnv: RouterEnv = {}): Promise<StackId> {
  if (opts.stack) return opts.stack;
  const env = routerEnv.env ?? process.env;
  const hasModule = routerEnv.hasModule ?? defaultHasModule;

  if (buildBrightdataWsEndpoint(env)) return "brightdata";
  if (await hasModule("rebrowser-playwright")) return "rebrowser";
  if (await hasModule("playwright")) return "vanilla";

  throw new BrowserDependencyError("playwright", "vanilla");
}

export function getStack(id: StackId): Stack {
  return STACKS[id];
}
