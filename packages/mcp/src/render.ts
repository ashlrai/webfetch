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
  const ran = providerReports.filter((r) => r.ok).length;
  const head =
    ran === 0 && providerReports.length > 0
      ? `0 candidate(s): none of the ${providerReports.length} requested provider(s) ran.`
      : `${candidates.length} candidate(s) from ${ran}/${providerReports.length} providers. Showing top ${shown.length}.`;
  const top = candidates
    .slice(0, 5)
    .map((c, i) => {
      const dim = c.width && c.height ? ` ${c.width}x${c.height}` : "";
      return `${i + 1}. [${c.license}]${dim} ${c.url}\n   ${c.attributionLine ?? ""}`;
    })
    .join("\n");
  const warn = warnings.length ? `\nwarnings:\n- ${warnings.join("\n- ")}` : "";
  const keyless = missingKeyLine(providerReports, warnings);
  const handoff =
    "\n\nCLI handoff for batches/repeated runs:\nwebfetch batch --jsonl --continue-on-error --candidates 5";
  const text = `${head}\n\n${top}${warn}${keyless}${handoff}`;
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

/**
 * One compact line naming default providers that were skipped for lack of a
 * key, with the env var each needs. Providers already explained in
 * `warnings` (explicitly requested ones) are not repeated.
 */
export function missingKeyLine(providerReports: ProviderReport[], warnings: string[] = []): string {
  const skipped = providerReports.filter(
    (r) => r.skipped === "missing-auth" && !(r.error && warnings.includes(r.error)),
  );
  if (skipped.length === 0) return "";
  const parts = skipped.map((r) => {
    const env = (r.errorContext?.missingEnv as string[] | undefined) ?? [];
    return env.length ? `${r.provider} (${env.join(" + ")})` : r.provider;
  });
  return `\nskipped, no API key: ${parts.join(", ")}. Add keys to this MCP server's "env" to enable them.`;
}

function summarizeReports(providerReports: ProviderReport[]): ProviderReport[] {
  return providerReports.map((r) => ({
    provider: r.provider,
    ok: r.ok,
    count: r.count,
    timeMs: r.timeMs,
    error: r.ok ? undefined : r.error,
    skipped: r.skipped,
    ...(r.skipped === "missing-auth" && r.errorContext ? { errorContext: r.errorContext } : {}),
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
