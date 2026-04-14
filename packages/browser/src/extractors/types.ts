import type { ImageCandidate } from "@webfetch/core";
import type { ExtractorId } from "../types.ts";

export interface ExtractContext {
  sourcePageUrl: string;
  /** Raw HTML (from a fetch, a playwright `.content()`, or a fixture). */
  html: string;
  /** Optional screenshot bytes to store alongside results. */
  screenshot?: Uint8Array;
}

export interface ExtractResult {
  extractor: ExtractorId;
  candidates: ImageCandidate[];
  warnings: string[];
}

export class ExtractorError extends Error {
  constructor(
    public extractor: ExtractorId,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${extractor}] ${message}`);
    this.name = "ExtractorError";
  }
}
