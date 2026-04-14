/**
 * Common stack contract. Each stack (vanilla, rebrowser, camoufox, brightdata)
 * implements this so the router can swap them transparently.
 */

import type { BrowserOptions, StackId } from "../types.ts";

/** Loosely-typed Playwright page — we don't require playwright types in core. */
export interface StackPage {
  goto(url: string, opts?: unknown): Promise<unknown>;
  content(): Promise<string>;
  screenshot(opts?: unknown): Promise<Uint8Array>;
  evaluate<T = unknown>(fn: any, arg?: unknown): Promise<T>;
  close(): Promise<void>;
}

export interface StackSession {
  stack: StackId;
  newPage(): Promise<StackPage>;
  close(): Promise<void>;
}

export interface Stack {
  id: StackId;
  open(opts: BrowserOptions): Promise<StackSession>;
}
