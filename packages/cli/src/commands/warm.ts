/**
 * `webfetch warm` — cache warm-up daemon.
 *
 * Accepts a rolling list of search queries (stdin JSON Lines, a file, or a
 * config-provided list) and periodically executes them in parallel,
 * pre-populating the shared cache and tracking hit rates across providers.
 *
 * Usage:
 *   webfetch warm --input queries.jsonl --interval 300 --parallel 4 --output warmth-report.json
 *   cat queries.jsonl | webfetch warm --interval 60 --parallel 2
 *
 * Each input line is a JSON object:
 *   { "query": "drake portrait", "licensePolicy": "safe-only", "providers": ["wikimedia"] }
 */

import type { ParsedArgs } from "../args.ts";
import { getBool, getInt, getString } from "../args.ts";
import { c, renderTable } from "../format.ts";
import { CacheWarmer } from "webfetch-core";
import type { WarmthReport } from "webfetch-core";
import type { CommandIO } from "../commands.ts";

const DEFAULT_IO_WARM = {
  stdout: (s: string) => process.stdout.write(`${s}\n`),
  stderr: (s: string) => process.stderr.write(`${s}\n`),
  env: process.env,
};

/**
 * `webfetch warm` subcommand.
 *
 * Flags:
 *   --input PATH        JSON Lines file of WarmQuery objects (omit to read stdin)
 *   --interval N        Seconds between runs (default: 300)
 *   --parallel N        Max concurrent searches per run (default: 4)
 *   --output PATH       Write last WarmthReport JSON to this path
 *   --once              Run exactly once then exit (no looping)
 *   --json              Print WarmthReport as JSON to stdout instead of table
 *   --verbose           Print per-provider metrics table
 *   --predict           Show predicted hit rates before each run
 */
export async function cmdWarm(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO_WARM,
): Promise<number> {
  const env = io.env ?? process.env;
  const inputPath = getString(args.flags, "input", "i");
  const intervalSeconds = getInt(args.flags, "interval") ?? 300;
  const parallel = getInt(args.flags, "parallel") ?? 4;
  const outputPath = getString(args.flags, "output", "o");
  const once = getBool(args.flags, "once");
  const json = getBool(args.flags, "json");
  const verbose = getBool(args.flags, "verbose");

  if (intervalSeconds < 1) {
    io.stderr(c.red("--interval must be >= 1 second"));
    return 2;
  }
  if (parallel < 1 || parallel > 64) {
    io.stderr(c.red("--parallel must be between 1 and 64"));
    return 2;
  }

  const reports: WarmthReport[] = [];

  const warmer = new CacheWarmer({
    inputPath: inputPath ?? undefined,
    intervalSeconds,
    parallel,
    outputPath: outputPath ?? undefined,

    onReport(report) {
      reports.push(report);
      emitReport(report, { json, verbose }, io);
    },

    onError(err, context) {
      io.stderr(c.yellow(`warm: error (${context}): ${err.message}`));
    },
  });

  if (once) {
    // Load + run once, then exit.
    try {
      await warmer.runOnce();
    } catch (err) {
      io.stderr(c.red(`warm: fatal: ${(err as Error).message}`));
      return 1;
    }
    return 0;
  }

  // Daemon mode: run until SIGINT.
  if (!json) {
    io.stderr(c.dim(`warm: starting daemon (interval=${intervalSeconds}s, parallel=${parallel})${inputPath ? ` from ${inputPath}` : " (stdin)"}`));
    io.stderr(c.dim("warm: press Ctrl-C to stop"));
  }

  let stopped = false;
  const onSig = () => {
    if (!stopped) {
      stopped = true;
      warmer.stop();
      if (!json) io.stderr(c.dim("\nwarm: stopping"));
    }
  };
  process.on("SIGINT", onSig);

  try {
    await warmer.start();
  } catch (err) {
    io.stderr(c.red(`warm: fatal: ${(err as Error).message}`));
    process.off("SIGINT", onSig);
    return 1;
  }

  process.off("SIGINT", onSig);
  return 0;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function emitReport(
  report: WarmthReport,
  opts: { json: boolean; verbose: boolean },
  io: CommandIO,
): void {
  if (opts.json) {
    io.stdout(JSON.stringify(report, null, 2));
    return;
  }

  const hitPct = Number.isNaN(report.cacheHitRate)
    ? "n/a"
    : `${(report.cacheHitRate * 100).toFixed(1)}%`;

  io.stdout(
    c.bold(`[warm] ${report.generatedAt}`) +
    c.dim(`  queries=${report.queriesRun}  candidates=${report.totalCandidates}`) +
    `  cacheHit=${hitPct}` +
    c.dim(`  ${report.timeMs}ms`),
  );

  if (opts.verbose && report.perProviderMetrics.length > 0) {
    const cols = [
      { header: "provider", width: 24 },
      { header: "results", width: 8 },
      { header: "hitRate", width: 9 },
      { header: "medConf", width: 9 },
    ];
    const rows = report.perProviderMetrics.map((m) => [
      m.provider,
      String(m.resultCount),
      Number.isNaN(m.hitRate) ? "n/a" : `${(m.hitRate * 100).toFixed(1)}%`,
      m.medianConfidence.toFixed(3),
    ]);
    io.stdout(renderTable(cols, rows));
    io.stdout("");
  }

  if (opts.verbose && report.predictedHitRates.length > 0) {
    io.stdout(c.dim("predicted hit rates (before run):"));
    for (const p of report.predictedHitRates) {
      io.stdout(c.dim(`  ${p.provider}: ${(p.predicted * 100).toFixed(1)}%`));
    }
    io.stdout("");
  }
}
