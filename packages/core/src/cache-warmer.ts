/**
 * CacheWarmer — daemon-mode batch warm-up for the webfetch shared cache.
 *
 * Accepts a rolling list of search queries (from stdin JSON Lines, a file,
 * or a programmatic array), executes them in parallel on a fixed interval,
 * pre-populates the disk cache, and emits `WarmthReport` objects every N
 * queries or at end of interval.
 *
 * Design goals:
 *  - Zero network calls beyond `searchImages()` (cache writing is handled by
 *    the existing federation + download layer).
 *  - Concurrent-safe: if a prior interval is still running when the next one
 *    fires, the new interval is skipped entirely (no queue build-up).
 *  - Fully testable without spawning subprocesses: all I/O is injected.
 */

import { readFile } from "node:fs/promises";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { searchImages } from "./federation.ts";
import { predictCacheHits } from "./cache-analytics.ts";
import type { ProviderId, SearchOptions } from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One entry in a queries JSON Lines file or stdin stream. */
export interface WarmQuery {
  /** The search query string. */
  query: string;
  /** Optional license policy override for this query. */
  licensePolicy?: SearchOptions["licensePolicy"];
  /** Optional provider list override for this query. */
  providers?: ProviderId[];
}

/** Per-provider metrics inside a WarmthReport. */
export interface WarmthProviderMetrics {
  provider: ProviderId;
  /** Total result candidates returned by this provider across all queries in this run. */
  resultCount: number;
  /**
   * Fraction of candidates for this provider that were cache hits.
   * Range [0, 1]. NaN when resultCount = 0.
   */
  hitRate: number;
  /** Median confidence score across all candidates from this provider. */
  medianConfidence: number;
}

/**
 * Emitted after each warm-up interval run (or programmatically via `onReport`).
 * Suitable for agent introspection and --output JSON file.
 */
export interface WarmthReport {
  /** Timestamp (ISO 8601) when this report was generated. */
  generatedAt: string;
  /** Number of queries actually executed in this interval. */
  queriesRun: number;
  /**
   * Total candidate images returned across all queries and providers.
   * These are the images that were fetched into the cache.
   */
  totalCandidates: number;
  /**
   * Fraction of candidates served from the cache (i.e. not requiring a
   * live provider call). Range [0, 1]. NaN when totalCandidates = 0.
   */
  cacheHitRate: number;
  /** Wall-clock time in ms for this interval's execution. */
  timeMs: number;
  /** Per-provider breakdown. */
  perProviderMetrics: WarmthProviderMetrics[];
  /**
   * Predicted cache-hit rates BEFORE the run (from predictCacheHits()).
   * Useful for comparing prediction vs actual.
   */
  predictedHitRates: Array<{ provider: ProviderId; predicted: number }>;
}

/** Options for constructing a `CacheWarmer`. */
export interface CacheWarmerOptions {
  /** Query input source. Mutually exclusive; precedence: queries > inputPath > stdin. */
  queries?: WarmQuery[];
  /** Path to a JSON Lines file of WarmQuery objects. */
  inputPath?: string;
  /** Interval between runs in seconds. Defaults to 300 (5 min). */
  intervalSeconds?: number;
  /** Max parallel searches per interval. Defaults to 4. */
  parallel?: number;
  /** Path to write the last WarmthReport JSON to. Optional. */
  outputPath?: string;
  /** Default search options applied to every query (can be overridden per-query). */
  searchDefaults?: Omit<SearchOptions, "providers" | "licensePolicy">;
  /** Called after each interval with the WarmthReport. */
  onReport?: (report: WarmthReport) => void;
  /** Called on non-fatal errors (e.g. a single query failing). */
  onError?: (err: Error, query: string) => void;
  /** Injectable sleep for testing interval skips. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable stdin reader for testing. */
  readStdin?: () => AsyncIterable<string>;
  /** Injectable searchImages for testing. */
  searchFn?: typeof searchImages;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse one JSON Line into a WarmQuery. Returns undefined on blank/comment lines. */
export function parseWarmQuery(line: string): WarmQuery | undefined {
  const s = line.trim();
  if (!s || s.startsWith("#")) return undefined;
  try {
    const obj = JSON.parse(s) as Record<string, unknown>;
    const query = typeof obj.query === "string" ? obj.query.trim() : "";
    if (!query) return undefined;
    const licensePolicy = typeof obj.licensePolicy === "string"
      ? (obj.licensePolicy as SearchOptions["licensePolicy"])
      : undefined;
    const providers = Array.isArray(obj.providers)
      ? (obj.providers.filter((p) => typeof p === "string") as ProviderId[])
      : undefined;
    return { query, ...(licensePolicy ? { licensePolicy } : {}), ...(providers?.length ? { providers } : {}) };
  } catch {
    return undefined;
  }
}

async function* linesFromProcessStdin(): AsyncIterable<string> {
  const stream = process.stdin as NodeJS.ReadStream;
  stream.setEncoding("utf8");
  let buf = "";
  for await (const chunk of stream as AsyncIterable<string>) {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
  }
  if (buf.length > 0) yield buf;
}

async function readQueriesFromFile(path: string): Promise<WarmQuery[]> {
  const raw = await readFile(path, "utf8");
  const result: WarmQuery[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const q = parseWarmQuery(line);
    if (q) result.push(q);
  }
  return result;
}

async function readQueriesFromStdin(readStdin?: () => AsyncIterable<string>): Promise<WarmQuery[]> {
  const source = readStdin ? readStdin() : linesFromProcessStdin();
  const result: WarmQuery[] = [];
  for await (const line of source) {
    const q = parseWarmQuery(line);
    if (q) result.push(q);
  }
  return result;
}

/** Compute median of a sorted or unsorted numeric array. Returns 0 for empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Run `fn` for each item in `items` with at most `concurrency` in-flight. */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// CacheWarmer class
// ---------------------------------------------------------------------------

/**
 * Daemon that periodically warms the webfetch cache by executing a list of
 * queries in parallel and tracking hit rates.
 *
 * @example
 * ```ts
 * const warmer = new CacheWarmer({ inputPath: "queries.jsonl", intervalSeconds: 300, parallel: 4 });
 * await warmer.start(); // runs until stop() is called
 * ```
 */
export class CacheWarmer {
  private readonly options: Required<
    Pick<CacheWarmerOptions, "intervalSeconds" | "parallel">
  > & CacheWarmerOptions;

  private _running = false;
  private _executing = false;
  private _stopRequested = false;

  constructor(options: CacheWarmerOptions = {}) {
    this.options = {
      intervalSeconds: options.intervalSeconds ?? 300,
      parallel: options.parallel ?? 4,
      ...options,
    };
  }

  /** True while the interval loop is active. */
  get isRunning(): boolean {
    return this._running;
  }

  /** True while an interval execution is in progress. */
  get isExecuting(): boolean {
    return this._executing;
  }

  // --------------------------------------------------------------------------
  // Query loading
  // --------------------------------------------------------------------------

  /** Load queries from the configured source (array, file, or stdin). */
  async loadQueries(): Promise<WarmQuery[]> {
    if (this.options.queries?.length) {
      return this.options.queries;
    }
    if (this.options.inputPath) {
      return readQueriesFromFile(this.options.inputPath);
    }
    return readQueriesFromStdin(this.options.readStdin);
  }

  // --------------------------------------------------------------------------
  // Single-interval execution
  // --------------------------------------------------------------------------

  /**
   * Execute one warm-up interval: load queries, run them with concurrency,
   * collect metrics, emit a WarmthReport.
   *
   * Returns the report. Throws only for unrecoverable errors (e.g. I/O failure
   * on loading queries). Per-query errors are swallowed and reported via `onError`.
   */
  async runOnce(queries?: WarmQuery[]): Promise<WarmthReport> {
    const startMs = Date.now();
    const resolvedQueries = queries ?? (await this.loadQueries());

    if (resolvedQueries.length === 0) {
      const report: WarmthReport = {
        generatedAt: new Date().toISOString(),
        queriesRun: 0,
        totalCandidates: 0,
        cacheHitRate: Number.NaN,
        timeMs: Date.now() - startMs,
        perProviderMetrics: [],
        predictedHitRates: [],
      };
      this._emitReport(report);
      return report;
    }

    // Collect predicted hit rates before running (uses the first query as proxy
    // since per-query predictions would be expensive; aggregate across providers).
    const allProviders = [
      ...new Set(resolvedQueries.flatMap((q) => q.providers ?? [])),
    ] as ProviderId[];
    const predictions = allProviders.length > 0
      ? predictCacheHits(resolvedQueries[0]!.query, allProviders)
      : [];

    const predictedHitRates = predictions.map((p) => ({
      provider: p.provider,
      predicted: p.pCacheHit,
    }));

    // Per-provider accumulators: { hits, total, confidences[] }
    type ProvAgg = { hits: number; total: number; confidences: number[] };
    const provAgg = new Map<ProviderId, ProvAgg>();

    const searchFn = this.options.searchFn ?? searchImages;
    const concurrency = Math.max(1, Math.min(32, this.options.parallel));

    await runWithConcurrency(resolvedQueries, concurrency, async (wq) => {
      try {
        const opts: SearchOptions = {
          ...this.options.searchDefaults,
          ...(wq.licensePolicy ? { licensePolicy: wq.licensePolicy } : {}),
          ...(wq.providers?.length ? { providers: wq.providers } : {}),
        };
        const bundle = await searchFn(wq.query, opts);

        for (const r of bundle.providerReports) {
          // Determine cache-hit status: if the provider returned results in
          // a negligible time (<= 5ms), we treat it as a cache hit heuristic.
          // The more reliable signal is providerReport.timeMs < 5.
          const isHit = r.ok && r.timeMs <= 5 && r.count > 0;
          const pid = r.provider as ProviderId;

          let agg = provAgg.get(pid);
          if (!agg) {
            agg = { hits: 0, total: 0, confidences: [] };
            provAgg.set(pid, agg);
          }
          if (r.ok) {
            agg.total += r.count;
            if (isHit) agg.hits += r.count;
          }
        }

        // Collect candidate confidences per provider.
        for (const cand of bundle.candidates) {
          const pid = cand.source as ProviderId;
          let agg = provAgg.get(pid);
          if (!agg) {
            agg = { hits: 0, total: 0, confidences: [] };
            provAgg.set(pid, agg);
          }
          const conf = (cand as any).confidence as number | undefined;
          if (typeof conf === "number") {
            agg.confidences.push(conf);
          }
        }
      } catch (err) {
        this.options.onError?.(err as Error, wq.query);
      }
    });

    // Build per-provider metrics.
    const perProviderMetrics: WarmthProviderMetrics[] = [];
    let totalCandidates = 0;
    let totalHits = 0;

    for (const [provider, agg] of provAgg) {
      const hitRate = agg.total > 0 ? agg.hits / agg.total : Number.NaN;
      const medianConf = median(agg.confidences);
      perProviderMetrics.push({
        provider,
        resultCount: agg.total,
        hitRate,
        medianConfidence: medianConf,
      });
      totalCandidates += agg.total;
      totalHits += agg.hits;
    }

    // Sort by resultCount desc for readability.
    perProviderMetrics.sort((a, b) => b.resultCount - a.resultCount);

    const cacheHitRate = totalCandidates > 0
      ? totalHits / totalCandidates
      : Number.NaN;

    const report: WarmthReport = {
      generatedAt: new Date().toISOString(),
      queriesRun: resolvedQueries.length,
      totalCandidates,
      cacheHitRate,
      timeMs: Date.now() - startMs,
      perProviderMetrics,
      predictedHitRates,
    };

    this._emitReport(report);
    return report;
  }

  // --------------------------------------------------------------------------
  // Daemon loop
  // --------------------------------------------------------------------------

  /**
   * Start the daemon loop. Loads queries once then runs them every `intervalSeconds`.
   * If a prior interval is still running when the next fires, that tick is skipped.
   *
   * Resolves when `stop()` is called.
   */
  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    this._stopRequested = false;

    const intervalMs = this.options.intervalSeconds * 1_000;
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    // Pre-load queries once (so stdin is only read on startup).
    let queries: WarmQuery[];
    try {
      queries = await this.loadQueries();
    } catch (err) {
      this._running = false;
      throw err;
    }

    try {
      while (!this._stopRequested) {
        if (this._executing) {
          // Prior interval still running — skip this tick.
          await sleep(intervalMs);
          continue;
        }

        this._executing = true;
        try {
          await this.runOnce(queries);
        } catch (err) {
          this.options.onError?.(err as Error, "(interval)");
        } finally {
          this._executing = false;
        }

        if (this._stopRequested) break;
        await sleep(intervalMs);
      }
    } finally {
      this._running = false;
    }
  }

  /** Stop the daemon loop gracefully (after the current interval finishes). */
  stop(): void {
    this._stopRequested = true;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private async _emitReport(report: WarmthReport): Promise<void> {
    this.options.onReport?.(report);

    if (this.options.outputPath) {
      try {
        await mkdir(dirname(this.options.outputPath), { recursive: true });
        await writeFile(this.options.outputPath, JSON.stringify(report, null, 2), "utf8");
      } catch (err) {
        this.options.onError?.(err as Error, "(output-write)");
      }
    }
  }
}
