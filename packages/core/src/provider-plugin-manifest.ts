/**
 * PluginManifest — schema for third-party provider plugins.
 *
 * A `PluginManifest` is the public contract a plugin module must satisfy.
 * It is richer than the internal `ProviderPluginDescriptor` and adds explicit
 * versioning, capability declarations, and a health-check URL so the host can
 * validate a plugin before wiring it into federation.
 *
 * Plugins export a `manifest` named export; `loadPluginFromPath` reads that
 * export and validates it against this interface before returning it.
 */

import type { SearchOptions, ImageCandidate } from "./types.ts";

// ---------------------------------------------------------------------------
// PluginCapability
// ---------------------------------------------------------------------------

/**
 * Capabilities a plugin may declare.  The host uses these for routing — e.g.
 * only plugins with `"findSimilar"` are included in reverse-image searches.
 */
export type PluginCapability =
  | "search"
  | "findSimilar"
  | "batch"
  | "filter"
  | "reverse-image";

// ---------------------------------------------------------------------------
// PluginAuth
// ---------------------------------------------------------------------------

/**
 * Auth contract for a plugin.
 *
 * - `envVars` — environment-variable names required at runtime.
 * - `keys`    — named keys passed via `SearchOptions.auth` (opaque strings).
 * - `scopes`  — optional human-readable list of permission scopes (for display).
 */
export interface PluginAuth {
  /** Environment-variable names this plugin reads (e.g. `["MY_API_KEY"]`). */
  envVars?: string[];
  /** ProviderAuth field names this plugin reads from `opts.auth`. */
  keys?: string[];
  /** Human-readable permission scopes (for display in `webfetch plugin list`). */
  scopes?: string[];
}

// ---------------------------------------------------------------------------
// PluginManifest
// ---------------------------------------------------------------------------

/**
 * Full manifest describing a third-party provider plugin.
 *
 * Plugins must export a `manifest` constant of this type at their top level.
 * The loader validates the shape before wiring the plugin into the registry.
 *
 * @example
 * ```ts
 * // my-plugin/index.ts
 * import type { PluginManifest } from "webfetch-core/provider-plugin-manifest";
 *
 * export const manifest: PluginManifest = {
 *   id: "my-image-source",
 *   name: "My Image Source",
 *   version: "1.0.0",
 *   capabilities: ["search"],
 *   search: async (query, opts) => [],
 *   healthCheckUrl: "https://api.myimagesource.com/health",
 * };
 * ```
 */
export interface PluginManifest {
  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /**
   * Unique machine identifier.
   * Must be non-empty and contain no whitespace.
   * Example: `"google-images-scraper"`, `"artstation"`, `"etsy-images"`.
   */
  id: string;

  /**
   * Human-readable display name shown in `webfetch plugin list` output and
   * in agent introspection.
   */
  name: string;

  /**
   * Semantic version string of the plugin itself (not the webfetch-core API).
   * Used for conflict detection when multiple versions of the same plugin are
   * present, and surfaced in `webfetch plugin list`.
   * Format: `"MAJOR.MINOR.PATCH"` (semver).
   */
  version: string;

  // -------------------------------------------------------------------------
  // Required functionality
  // -------------------------------------------------------------------------

  /**
   * The primary search function.
   * Must accept `(query: string, opts: SearchOptions)` and return
   * `Promise<ImageCandidate[]>`.
   */
  search: (query: string, opts: SearchOptions) => Promise<ImageCandidate[]>;

  // -------------------------------------------------------------------------
  // Optional functionality
  // -------------------------------------------------------------------------

  /**
   * Optional reverse-image search.
   * When present, `"findSimilar"` is automatically added to `capabilities`.
   */
  findSimilar?: (
    ref: { url?: string; bytes?: Uint8Array },
    opts: SearchOptions,
  ) => Promise<ImageCandidate[]>;

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  /**
   * Capability flags the plugin declares.
   * `"search"` is always present (auto-added if missing).
   * `"findSimilar"` is auto-added when `findSimilar` is defined.
   */
  capabilities: PluginCapability[];

  /**
   * Auth requirements.
   * When provided, the loader validates that required env vars or keys are
   * present before wiring the plugin.
   */
  auth?: PluginAuth;

  /**
   * Default license tag for results from this provider.
   * Accepts any string — not limited to the built-in `License` union.
   */
  defaultLicense?: string;

  /**
   * URL to ping for health checks.
   * Used by `webfetch plugin test <id>` to verify the plugin's upstream is
   * reachable before running a search.
   * Example: `"https://api.myimagesource.com/health"`.
   */
  healthCheckUrl?: string;

  /**
   * Short description (≤ 200 chars) for display in `webfetch plugin list`.
   */
  description?: string;

  /**
   * URL or data-URI of an icon for display in UIs.
   */
  icon?: string;

  /**
   * The webfetch-core API version range this plugin was built against.
   * Used for compatibility warnings.
   * Example: `"^0.1.0"`.
   */
  coreVersion?: string;

  /**
   * Plugin author or organisation.
   * Example: `"Jane Developer <jane@example.com>"`.
   */
  author?: string;

  /**
   * URL to the plugin repository or homepage.
   */
  repository?: string;
}

// ---------------------------------------------------------------------------
// PluginManifestValidationResult
// ---------------------------------------------------------------------------

/**
 * Result of validating a `PluginManifest` via `validatePluginManifest`.
 */
export interface PluginManifestValidationResult {
  /** Whether the manifest is valid. */
  valid: boolean;
  /** List of validation errors (empty when valid). */
  errors: string[];
  /** List of non-fatal warnings (e.g. missing optional recommended fields). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// validatePluginManifest
// ---------------------------------------------------------------------------

/**
 * Validate a value against the `PluginManifest` schema.
 *
 * Returns a `PluginManifestValidationResult` with error + warning lists.
 * Does NOT throw — callers decide how to handle failures.
 *
 * @example
 * ```ts
 * const result = validatePluginManifest(mod.manifest);
 * if (!result.valid) throw new Error(result.errors.join("; "));
 * ```
 */
export function validatePluginManifest(value: unknown): PluginManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof value !== "object" || value === null) {
    errors.push("manifest must be a non-null object");
    return { valid: false, errors, warnings };
  }

  const m = value as Record<string, unknown>;

  // id: non-empty string, no whitespace
  if (typeof m.id !== "string" || m.id.trim().length === 0) {
    errors.push("id: must be a non-empty string");
  } else if (/\s/.test(m.id)) {
    errors.push("id: must not contain whitespace");
  }

  // name: non-empty string
  if (typeof m.name !== "string" || m.name.trim().length === 0) {
    errors.push("name: must be a non-empty string");
  }

  // version: semver-like string x.y.z
  if (typeof m.version !== "string" || m.version.trim().length === 0) {
    errors.push("version: must be a non-empty string (semver, e.g. \"1.0.0\")");
  } else if (!/^\d+\.\d+\.\d+/.test(m.version)) {
    warnings.push(`version: "${m.version}" does not look like semver (expected MAJOR.MINOR.PATCH)`);
  }

  // search: function with ≥2 params
  if (typeof m.search !== "function") {
    errors.push("search: must be a function");
  } else if ((m.search as Function).length < 2) {
    errors.push("search: must accept at least 2 parameters (query, opts)");
  }

  // findSimilar: when present must be function
  if (m.findSimilar !== undefined && typeof m.findSimilar !== "function") {
    errors.push("findSimilar: when provided, must be a function");
  }

  // capabilities: array of strings
  if (!Array.isArray(m.capabilities)) {
    errors.push("capabilities: must be an array of capability strings");
  } else {
    for (const cap of m.capabilities as unknown[]) {
      if (typeof cap !== "string") {
        errors.push(`capabilities: each entry must be a string, got ${typeof cap}`);
        break;
      }
    }
  }

  // auth: optional object
  if (m.auth !== undefined) {
    if (typeof m.auth !== "object" || m.auth === null) {
      errors.push("auth: when provided, must be an object");
    } else {
      const auth = m.auth as Record<string, unknown>;
      if (auth.envVars !== undefined && !Array.isArray(auth.envVars)) {
        errors.push("auth.envVars: must be an array of strings");
      }
      if (auth.keys !== undefined && !Array.isArray(auth.keys)) {
        errors.push("auth.keys: must be an array of strings");
      }
    }
  }

  // healthCheckUrl: optional string
  if (m.healthCheckUrl !== undefined && typeof m.healthCheckUrl !== "string") {
    errors.push("healthCheckUrl: when provided, must be a string");
  }

  // Recommended fields (warnings only)
  if (!m.description) warnings.push("description: recommended for display in plugin list");
  if (!m.healthCheckUrl) warnings.push("healthCheckUrl: recommended for health-check support");

  return { valid: errors.length === 0, errors, warnings };
}
