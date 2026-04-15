/**
 * Vision-picker. Given a screenshot + N candidate image URLs, asks Claude
 * to identify the hero image by number.
 *
 * @anthropic-ai/sdk is an optional peer dep — we load it dynamically and
 * throw a helpful error if missing. An injectable `anthropic` factory is
 * exposed for tests (stubs).
 */

import type { ImageCandidate } from "@webfetch/core";
import { BrowserDependencyError, type VisionConfig } from "./types.ts";

const DEFAULT_MODEL = "claude-opus-4-6";

export interface VisionClient {
  messages: {
    create: (req: unknown) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

export type VisionClientFactory = (apiKey: string) => VisionClient;

let overrideFactory: VisionClientFactory | null = null;

/** Test hook: inject a stub Anthropic-like client. */
export function _setVisionClientFactory(f: VisionClientFactory | null): void {
  overrideFactory = f;
}

async function getClient(apiKey: string): Promise<VisionClient> {
  if (overrideFactory) return overrideFactory(apiKey);
  let Anthropic: any;
  try {
    // @ts-expect-error optional peer; not bundled
    const mod: any = await import("@anthropic-ai/sdk");
    Anthropic = mod.default ?? mod.Anthropic ?? mod;
  } catch {
    throw new BrowserDependencyError("@anthropic-ai/sdk", "vanilla");
  }
  const client = new Anthropic({ apiKey });
  return client as VisionClient;
}

export function buildVisionPrompt(candidates: ImageCandidate[]): string {
  const list = candidates
    .map((c, i) => `${i + 1}. ${c.url}${c.title ? ` — ${c.title}` : ""}`)
    .join("\n");
  return [
    "You will see a screenshot of a web page and a numbered list of candidate image URLs scraped from that page.",
    "Pick the single number that corresponds to the PRIMARY HERO image of the page — the one a human editor would use to represent the page's subject.",
    "Reply with ONLY the number (1, 2, 3, ...). No prose, no explanation. If none qualify, reply with 0.",
    "",
    "Candidates:",
    list,
  ].join("\n");
}

/** Extract the first integer 0..N from a free-form model reply. */
export function parseVisionReply(text: string, n: number): number | null {
  const m = text.match(/-?\d+/);
  if (!m) return null;
  const n0 = Number(m[0]);
  if (!Number.isFinite(n0)) return null;
  if (n0 < 0 || n0 > n) return null;
  return n0;
}

export async function pickHeroImage(
  pageBytes: Uint8Array,
  candidates: ImageCandidate[],
  opts: VisionConfig,
): Promise<ImageCandidate | null> {
  if (candidates.length === 0) return null;
  const client = await getClient(opts.anthropicKey);
  const model = opts.model ?? DEFAULT_MODEL;
  const b64 = Buffer.from(pageBytes).toString("base64");

  const res = await client.messages.create({
    model,
    max_tokens: 16,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: b64 },
          },
          { type: "text", text: buildVisionPrompt(candidates) },
        ],
      },
    ],
  });

  const block = res.content.find((c) => c.type === "text");
  const text = block?.text ?? "";
  const idx = parseVisionReply(text, candidates.length);
  if (idx === null || idx === 0) return null;
  return candidates[idx - 1] ?? null;
}
