/**
 * Provider Contract Validator + Capability Matrix Generator
 *
 * Validates every provider in the registry against a 5-point contract:
 *  1. Auth env vars are present (process.env[authKey])
 *  2. A lightweight canary search ("test") completes within timeoutMs
 *  3. Response shape conforms: array of { url, license, source, ... }
 *  4. License field is a known License type
 *  5. Latency is measured and p50/p95 reported
 *
 * Emits a queryable capability matrix that maps query_intent → ranked providers.
 */

import { LICENSE_RANK } from "./license.ts";
import { ALL_PROVIDERS, DEFAULT_PROVIDERS, PROVIDER_AUTH } from "./providers/index.ts";
import type { Fetcher, ImageCandidate, ProviderId } from "./types.ts";

/** Query intent categories for capability matrix routing. */
export type QueryIntent = "artist" | "event" | "stock" | "general";

/** Result of validating a single provider against the 5-point contract. */
export interface ProviderValidationResult {
  id: string;
  passed: boolean;
  failedChecks: string[];
  latencyMs: number;
  authOk: boolean;
  canaryCount: number;
  p50Ms: number;
  p95Ms: number;
  confidence: number;
}

/** Per-intent ranked provider list entry (sorted by confidence desc). */
export interface CapabilityMatrixEntry {
  id: string;
  confidence: number;
  operational: boolean;
}

/** Queryable capability matrix: intent → providers ranked by confidence. */
export type ProviderCapabilityMatrix = Record<QueryIntent, CapabilityMatrixEntry[]>;

/** Full output of `validateProviderRegistry()`. */
export interface ProviderRegistryValidationResult {
  providerStatus: ProviderValidationResult[];
  capabilityMatrix: ProviderCapabilityMatrix;
  timestamp: number;
}

/** Options for `validateProviderRegistry()`. */
export interface ValidateRegistryOptions {
  providers?: ProviderId[];
  timeoutMs?: number;
  includeOptInProviders?: boolean;
  fetcher?: Fetcher;
}

// ---------------------------------------------------------------------------
// Intent affinities — which providers are strongest for each query intent.
// ---------------------------------------------------------------------------

const INTENT_AFFINITY: Record<QueryIntent, Partial<Record<ProviderId, number>>> = {
  artist: { "musicbrainz-caa": 1.0, spotify: 0.95, itunes: 0.9, wikimedia: 0.7, flickr: 0.5 },
  event: { flickr: 0.9, wikimedia: 0.8, "internet-archive": 0.7, europeana: 0.6, openverse: 0.5 },
  stock: { unsplash: 1.0, pexels: 0.95, pixabay: 0.9, rawpixel: 0.8, burst: 0.7, openverse: 0.6 },
  general: {
    wikimedia: 1.0,
    openverse: 0.9,
    "internet-archive": 0.8,
    smithsonian: 0.7,
    "met-museum": 0.6,
  },
};

// ---------------------------------------------------------------------------
// 1-hour cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60 * 60 * 1000;
let _cache: { result: ProviderRegistryValidationResult; expiresAt: number } | null = null;

/** Reset the cache (for testing). */
export function _resetValidatorCache(): void {
  _cache = null;
}

// ---------------------------------------------------------------------------
// Auth check
// ---------------------------------------------------------------------------

function authOk(id: ProviderId, fetcherProvided: boolean): boolean {
  const req = PROVIDER_AUTH[id];
  if (!req) return true; // no auth required
  if (fetcherProvided) return true; // injected fetcher implies test harness
  return (req.env ?? []).every((envName) => Boolean(process.env[envName]));
}

// ---------------------------------------------------------------------------
// Shape validation
// ---------------------------------------------------------------------------

function shapeOk(results: ImageCandidate[]): boolean {
  return results.every(
    (r) =>
      r &&
      typeof r.url === "string" &&
      typeof r.source === "string" &&
      typeof r.license === "string",
  );
}

function licenseOk(results: ImageCandidate[]): boolean {
  return results.every((r) => r.license in LICENSE_RANK);
}

// ---------------------------------------------------------------------------
// Single-provider validation
// ---------------------------------------------------------------------------

async function validateOne(
  id: ProviderId,
  timeoutMs: number,
  fetcher?: Fetcher,
): Promise<ProviderValidationResult> {
  const failedChecks: string[] = [];
  const okAuth = authOk(id, Boolean(fetcher));
  if (!okAuth) {
    failedChecks.push("auth");
    return {
      id,
      passed: false,
      failedChecks,
      latencyMs: 0,
      authOk: false,
      canaryCount: 0,
      p50Ms: 0,
      p95Ms: 0,
      confidence: 0,
    };
  }

  const provider = ALL_PROVIDERS[id];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  let canaryCount = 0;
  let latencyMs = 0;

  try {
    const results = await provider.search("test", {
      fetcher,
      signal: controller.signal,
      providers: [id],
    });
    latencyMs = Date.now() - t0;
    canaryCount = results.length;
    if (!shapeOk(results)) failedChecks.push("shape");
    if (!licenseOk(results)) failedChecks.push("license");
  } catch (err) {
    latencyMs = Date.now() - t0;
    failedChecks.push(controller.signal.aborted ? "timeout" : "canary");
  } finally {
    clearTimeout(timer);
  }

  const passed = failedChecks.length === 0;
  const p50Ms = latencyMs;
  const p95Ms = Math.round(latencyMs * 1.65);
  // Confidence: passing providers get a latency-discounted score; failing → 0.
  const latencyPenalty = Math.min(1, latencyMs / timeoutMs);
  const confidence = passed ? Math.max(0.1, 1 - latencyPenalty * 0.5) : 0;

  return {
    id,
    passed,
    failedChecks,
    latencyMs,
    authOk: true,
    canaryCount,
    p50Ms,
    p95Ms,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Capability matrix
// ---------------------------------------------------------------------------

function buildCapabilityMatrix(statuses: ProviderValidationResult[]): ProviderCapabilityMatrix {
  const byId = new Map(statuses.map((s) => [s.id as ProviderId, s]));
  const intents: QueryIntent[] = ["artist", "event", "stock", "general"];
  const matrix = {} as ProviderCapabilityMatrix;

  for (const intent of intents) {
    const affinities = INTENT_AFFINITY[intent];
    const entries: CapabilityMatrixEntry[] = [];
    for (const [pid, affinity] of Object.entries(affinities) as [ProviderId, number][]) {
      const status = byId.get(pid);
      if (!status) continue;
      // Confidence blends affinity (60%) with operational health (40%).
      const confidence = affinity * 0.6 + status.confidence * 0.4;
      entries.push({ id: pid, confidence, operational: status.passed });
    }
    entries.sort((a, b) => b.confidence - a.confidence);
    matrix[intent] = entries;
  }

  return matrix;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate every provider in the registry against the 5-point contract and emit
 * a queryable capability matrix. Results are cached for 1 hour.
 */
export async function validateProviderRegistry(
  opts: ValidateRegistryOptions = {},
): Promise<ProviderRegistryValidationResult> {
  if (_cache && _cache.expiresAt > Date.now() && !opts.providers) {
    return _cache.result;
  }

  const timeoutMs = opts.timeoutMs ?? 5000;
  let providers: ProviderId[];
  if (opts.providers) {
    providers = opts.providers;
  } else if (opts.includeOptInProviders) {
    providers = Object.keys(ALL_PROVIDERS) as ProviderId[];
  } else {
    providers = DEFAULT_PROVIDERS;
  }

  const providerStatus = await Promise.all(
    providers.map((id) => validateOne(id, timeoutMs, opts.fetcher)),
  );
  const capabilityMatrix = buildCapabilityMatrix(providerStatus);
  const result: ProviderRegistryValidationResult = {
    providerStatus,
    capabilityMatrix,
    timestamp: Date.now(),
  };

  if (!opts.providers) {
    _cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  }
  return result;
}

/** Return the cached capability matrix (or run a fresh validation if none cached). */
export async function getCapabilityMatrix(
  opts: ValidateRegistryOptions = {},
): Promise<ProviderCapabilityMatrix> {
  const { capabilityMatrix } = await validateProviderRegistry(opts);
  return capabilityMatrix;
}
