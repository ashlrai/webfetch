/**
 * Render helpers — format core results as MCP tool content.
 *
 * Every tool returns structured JSON, but we also attach a short human-
 * readable text summary with license + attribution up top so a model reading
 * the tool result doesn't have to scan the JSON to know what's safe to use.
 */

import type { ImageCandidate, ProviderReport } from "webfetch-core";

export function renderSearch(
  candidates: ImageCandidate[],
  providerReports: ProviderReport[],
  warnings: string[],
): { content: { type: "text"; text: string }[]; structuredContent: unknown } {
  const shown = candidates.slice(0, 5);
  const head = `${candidates.length} candidate(s) from ${providerReports.filter((r) => r.ok).length}/${providerReports.length} providers. Showing top ${shown.length}.`;
  const top = candidates
    .slice(0, 5)
    .map((c, i) => {
      const dim = c.width && c.height ? ` ${c.width}x${c.height}` : "";
      return `${i + 1}. [${c.license}]${dim} ${c.url}\n   ${c.attributionLine ?? ""}`;
    })
    .join("\n");
  const warn = warnings.length ? `\nwarnings:\n- ${warnings.join("\n- ")}` : "";
  const handoff =
    "\n\nCLI handoff for batches/repeated runs:\nwebfetch batch --jsonl --continue-on-error --candidates 5";
  const text = `${head}\n\n${top}${warn}${handoff}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      results: shown,
      resultCount: candidates.length,
      providerReports: summarizeReports(providerReports),
      warnings,
    },
  };
}

function summarizeReports(providerReports: ProviderReport[]): ProviderReport[] {
  return providerReports.map((r) => ({
    provider: r.provider,
    ok: r.ok,
    count: r.count,
    timeMs: r.timeMs,
    error: r.ok ? undefined : r.error,
    skipped: r.skipped,
  }));
}

export function renderJson(obj: unknown): {
  content: { type: "text"; text: string }[];
  structuredContent: unknown;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  };
}
