/**
 * Runtime Provider Registry with Capability Discovery & Plugin Hooks.
 *
 * Decouples provider implementations from the hardcoded ALL_PROVIDERS map.
 * Agents and third-party code can call `registry.register()` to add custom
 * providers without modifying core. The registry is introspectable —
 * `findByCapability()` lets callers query what operations each provider
 * supports.
 *
 * Bootstrap: `packages/core/src/providers/index.ts` calls
 * `bootstrapRegistry()` to register all 25 built-in providers on first use.
 * Subsequent calls to `bootstrapRegistry()` are idempotent.
 *
 * Plugin system: Use `registerProvider(descriptor)` to add providers at
 * runtime without modifying core. Use `loadProvidersFromModules(paths)` to
 * dynamically import external `.ts` files that export a `descriptor`.
 * Use `resolveProviderAuth(id, opts)` for per-tenant key resolution.
 */

import type { Provider, ProviderId, SearchOptions, ProviderAuth } from "./types.ts";

// ---------------------------------------------------------------------------
// ProviderCapability
// ---------------------------------------------------------------------------

/**
 * Capabilities a provider may advertise.
 *
 * - `'search'`         — supports `provider.search()` (always true for Provider)
 * - `'findSimilar'`    — supports `provider.findSimilar()` (reverse-image)
 * - `'batch'`          — supports efficient multi-query batching
 * - `'reverse-image'`  — alias for findSimilar in agent-facing introspection
 * - `'filter'`         — supports server-side license / dimension filters
 */
export type ProviderCapability =
  | "search"
  | "findSimilar"
  | "batch"
  | "reverse-image"
  | "filter";

// ---------------------------------------------------------------------------
// ProviderMetadata
// ---------------------------------------------------------------------------

/**
 * Rich metadata attached to a provider registration.
 * Everything except `id` and `capabilities` is optional.
 */
export interface ProviderMetadata {
  /** Canonical machine identifier — must match `Provider.id`. */
  id: ProviderId | string;
  /** Human-readable display name. */
  name: string;
  /** Short description for UIs / agent introspection. */
  description?: string;
  /** License tag most results from this provider carry (mirrors Provider.defaultLicense). */
  defaultLicense?: string;
  /** Capabilities this provider exposes. Must include at least `'search'`. */
  capabilities: ProviderCapability[];
  /** Auth requirements for display; mirrors Provider.auth. */
  auth?: {
    keys: string[];
    env: string[];
  };
  /** Approximate rate limit for informational display. */
  rateLimit?: {
    requestsPerMinute?: number;
    requestsPerDay?: number;
    note?: string;
  };
  /** Rough cost tier — for agent cost-planning. */
  costs?: {
    tier: "free" | "freemium" | "paid";
    note?: string;
  };
  /** URL to ping for health checks (used by `checkAllProviders`). */
  healthCheckUrl?: string;
  /** When true, this provider is deprecated and may be removed in a future release. */
  deprecated?: boolean;
  /** Any extra provider-specific fields. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ProviderRegistration (internal entry)
// ---------------------------------------------------------------------------

interface ProviderRegistration {
  provider: Provider;
  metadata: ProviderMetadata;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

/**
 * Runtime registry of providers.  Instantiate via `createProviderRegistry()`
 * or use the module-level singleton `providerRegistry`.
 */
export interface ProviderRegistryInterface {
  /**
   * Register a provider with its metadata.
   * Throws if a provider with the same `id` is already registered and
   * `opts.replace` is not true.
   */
  register(
    id: string,
    provider: Provider,
    metadata: ProviderMetadata,
    opts?: { replace?: boolean },
  ): void;

  /** Retrieve a provider implementation by id, or `undefined` if not found. */
  get(id: string): Provider | undefined;

  /** Return all registered provider ids (enabled + disabled). */
  list(): string[];

  /** Return provider ids that have ALL of the given capabilities. */
  findByCapability(...caps: ProviderCapability[]): string[];

  /** Enable one or more providers (no-op for unknown ids). */
  enable(...ids: string[]): void;

  /** Disable one or more providers so `get()` returns undefined for them. */
  disable(...ids: string[]): void;

  /** Check whether a provider is currently enabled. */
  isEnabled(id: string): boolean;

  /** Retrieve metadata for a provider, or `undefined` if not registered. */
  getMetadata(id: string): ProviderMetadata | undefined;

  /** Return metadata for all registered providers (enabled + disabled). */
  listMetadata(): ProviderMetadata[];

  /** Return true if the registry has a registration for the given id. */
  has(id: string): boolean;

  /**
   * Remove a provider registration entirely.
   * Returns true if a registration existed and was removed.
   */
  unregister(id: string): boolean;

  /** Return a snapshot of {id → Provider} for all *enabled* providers. */
  toRecord(): Record<string, Provider>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ProviderRegistry implements ProviderRegistryInterface {
  private readonly _entries = new Map<string, ProviderRegistration>();

  register(
    id: string,
    provider: Provider,
    metadata: ProviderMetadata,
    opts: { replace?: boolean } = {},
  ): void {
    if (this._entries.has(id) && !opts.replace) {
      throw new Error(
        `ProviderRegistry: provider "${id}" is already registered. ` +
          `Pass { replace: true } to overwrite.`,
      );
    }
    // Ensure "search" is always present in capabilities
    const caps: ProviderCapability[] = metadata.capabilities.includes("search")
      ? metadata.capabilities
      : ["search", ...metadata.capabilities];

    // Auto-detect findSimilar capability from the provider implementation
    if (
      typeof (provider as any).findSimilar === "function" &&
      !caps.includes("findSimilar")
    ) {
      caps.push("findSimilar");
    }

    this._entries.set(id, {
      provider,
      metadata: { ...metadata, capabilities: caps },
      enabled: true,
    });
  }

  get(id: string): Provider | undefined {
    const entry = this._entries.get(id);
    if (!entry || !entry.enabled) return undefined;
    return entry.provider;
  }

  list(): string[] {
    return Array.from(this._entries.keys());
  }

  findByCapability(...caps: ProviderCapability[]): string[] {
    const result: string[] = [];
    for (const [id, entry] of this._entries) {
      if (caps.every((c) => entry.metadata.capabilities.includes(c))) {
        result.push(id);
      }
    }
    return result;
  }

  enable(...ids: string[]): void {
    for (const id of ids) {
      const entry = this._entries.get(id);
      if (entry) entry.enabled = true;
    }
  }

  disable(...ids: string[]): void {
    for (const id of ids) {
      const entry = this._entries.get(id);
      if (entry) entry.enabled = false;
    }
  }

  isEnabled(id: string): boolean {
    const entry = this._entries.get(id);
    return entry ? entry.enabled : false;
  }

  getMetadata(id: string): ProviderMetadata | undefined {
    return this._entries.get(id)?.metadata;
  }

  listMetadata(): ProviderMetadata[] {
    return Array.from(this._entries.values()).map((e) => e.metadata);
  }

  has(id: string): boolean {
    return this._entries.has(id);
  }

  unregister(id: string): boolean {
    return this._entries.delete(id);
  }

  toRecord(): Record<string, Provider> {
    const out: Record<string, Provider> = {};
    for (const [id, entry] of this._entries) {
      if (entry.enabled) out[id] = entry.provider;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

/** Global singleton registry. Bootstrap it by calling `bootstrapRegistry()`. */
export const providerRegistry: ProviderRegistryInterface = new ProviderRegistry();

/** Factory — useful for isolated testing. */
export function createProviderRegistry(): ProviderRegistryInterface {
  return new ProviderRegistry();
}

// ---------------------------------------------------------------------------
// ProviderPluginDescriptor — public plugin interface
// ---------------------------------------------------------------------------

/**
 * Descriptor for a pluggable provider.  Third-party modules export one of
 * these as `descriptor` so `loadProvidersFromModules()` can pick it up.
 *
 * Differences from the internal `Provider` shape:
 *  - `id` is a plain `string` (not constrained to the built-in `ProviderId` union).
 *  - `displayName` replaces `id` as the human-readable label.
 *  - `authRequired` is a flat string array of env-var names (simpler than
 *    `ProviderAuthRequirement`).
 *  - `findSimilar` is optional — callers check via `findByCapability`.
 *  - `icon` is an optional URL/data-URI for use in UIs.
 *  - `licenseDefault` mirrors `Provider.defaultLicense` but typed as string
 *    so custom providers can use non-standard license tags.
 */
export interface ProviderPluginDescriptor {
  /** Unique machine identifier. Must be non-empty and contain no whitespace. */
  id: string;
  /** Human-readable name shown in UIs and agent introspection. */
  displayName: string;
  /**
   * Search function.  Must accept `(query: string, opts: SearchOptions)` and
   * return `Promise<ImageCandidate[]>`.
   */
  search: Provider["search"];
  /**
   * Optional reverse-image search.  When present, `findSimilar` capability is
   * automatically added to the registry entry.
   */
  findSimilar?: Provider["findSimilar"];
  /** URL or data-URI of a provider icon (for display purposes). */
  icon?: string;
  /**
   * Default license tag for results from this provider.
   * Accepts any string — not limited to the built-in `License` union.
   */
  licenseDefault?: string;
  /**
   * Env-var names required by this provider.
   * When any listed var is absent, `resolveProviderAuth` treats the provider
   * as unauthenticated for that env-level tier.
   */
  authRequired?: string[];
}

// ---------------------------------------------------------------------------
// Mutable plugin registry (separate from the immutable ALL_PROVIDERS export)
// ---------------------------------------------------------------------------

/**
 * Mutable registry that holds runtime-registered plugin providers.
 * Built-in providers live in `ALL_PROVIDERS` (backwards compat); plugins live here.
 * The singleton `providerRegistry` holds both (built-ins are bootstrapped there).
 */
const _pluginRegistry = new Map<string, ProviderPluginDescriptor>();

// ---------------------------------------------------------------------------
// Schema validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a `ProviderPluginDescriptor` shape.
 * Returns a list of validation errors (empty = valid).
 */
function validateDescriptor(descriptor: unknown): string[] {
  const errors: string[] = [];

  if (typeof descriptor !== "object" || descriptor === null) {
    errors.push("descriptor must be a non-null object");
    return errors;
  }

  const d = descriptor as Record<string, unknown>;

  // id: non-empty string without whitespace
  if (typeof d.id !== "string" || d.id.trim().length === 0) {
    errors.push("id: must be a non-empty string");
  } else if (/\s/.test(d.id)) {
    errors.push("id: must not contain whitespace");
  }

  // displayName: non-empty string
  if (typeof d.displayName !== "string" || d.displayName.trim().length === 0) {
    errors.push("displayName: must be a non-empty string");
  }

  // search: function with length >= 2 (query, opts)
  if (typeof d.search !== "function") {
    errors.push("search: must be a function");
  } else if (d.search.length < 2) {
    errors.push("search: must accept at least 2 parameters (query, opts)");
  }

  // findSimilar: if present, must be a function
  if (d.findSimilar !== undefined && typeof d.findSimilar !== "function") {
    errors.push("findSimilar: when provided, must be a function");
  }

  // authRequired: if present, must be an array of strings
  if (d.authRequired !== undefined) {
    if (!Array.isArray(d.authRequired)) {
      errors.push("authRequired: when provided, must be an array of strings");
    } else {
      const nonString = (d.authRequired as unknown[]).filter((v) => typeof v !== "string");
      if (nonString.length > 0) {
        errors.push("authRequired: all elements must be strings");
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// registerProvider — public API
// ---------------------------------------------------------------------------

/**
 * Register a plugin provider at runtime.
 *
 * Validates the descriptor schema first; throws `TypeError` on invalid input.
 * Throws `Error` when a provider with the same id is already registered and
 * `opts.replace` is not `true`.
 *
 * Also registers the provider into the module-level `providerRegistry`
 * singleton so it participates in federation and capability queries.
 *
 * @example
 * ```ts
 * registerProvider({
 *   id: "my-source",
 *   displayName: "My Image Source",
 *   search: async (query, opts) => [],
 *   licenseDefault: "CC0",
 *   authRequired: ["MY_SOURCE_API_KEY"],
 * });
 * ```
 */
export function registerProvider(
  descriptor: ProviderPluginDescriptor,
  opts: { replace?: boolean } = {},
): void {
  // Schema validation
  const errors = validateDescriptor(descriptor);
  if (errors.length > 0) {
    throw new TypeError(
      `registerProvider: invalid descriptor for "${(descriptor as any)?.id ?? "<unknown>"}":\n` +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
  }

  const { id } = descriptor;

  // Duplicate check
  if (_pluginRegistry.has(id) && !opts.replace) {
    throw new Error(
      `registerProvider: provider "${id}" is already registered. ` +
        `Pass { replace: true } to overwrite.`,
    );
  }

  _pluginRegistry.set(id, descriptor);

  // Build a Provider-compatible shim for the singleton registry
  const providerShim: Provider = {
    id: id as ProviderId, // cast — custom ids extend beyond the built-in union
    defaultLicense: (descriptor.licenseDefault as any) ?? "UNKNOWN",
    requiresAuth: (descriptor.authRequired?.length ?? 0) > 0,
    auth:
      descriptor.authRequired && descriptor.authRequired.length > 0
        ? { env: descriptor.authRequired, keys: [] }
        : undefined,
    search: descriptor.search,
    ...(descriptor.findSimilar ? { findSimilar: descriptor.findSimilar } : {}),
  };

  // Build metadata for the registry
  const capabilities: ProviderCapability[] = ["search"];
  if (descriptor.findSimilar) capabilities.push("findSimilar");

  const metadata: ProviderMetadata = {
    id,
    name: descriptor.displayName,
    defaultLicense: descriptor.licenseDefault,
    capabilities,
    auth: descriptor.authRequired?.length
      ? { keys: [], env: descriptor.authRequired }
      : undefined,
  };

  providerRegistry.register(id, providerShim, metadata, { replace: opts.replace });
}

// ---------------------------------------------------------------------------
// loadProvidersFromModules — dynamic import
// ---------------------------------------------------------------------------

/**
 * Result of a single module load attempt.
 */
export interface ModuleLoadResult {
  /** Path that was imported. */
  path: string;
  /** Whether the module loaded and its descriptor was registered successfully. */
  success: boolean;
  /** Provider id that was registered (only set on success). */
  providerId?: string;
  /** Error message when loading or validation failed. */
  error?: string;
}

/**
 * Dynamically import `.ts` (or compiled `.js`) modules that each export a
 * `descriptor: ProviderPluginDescriptor` at their top level.  Useful for
 * loading custom provider add-ons at runtime without recompiling webfetch-core.
 *
 * Each module is imported with `await import(path)`.  Failures for individual
 * modules are captured in the result array rather than throwing so one bad
 * module does not block the rest.
 *
 * @param modulePaths  Absolute or resolvable paths to the provider modules.
 * @param opts.replace When true, allow overwriting already-registered ids.
 * @returns Array with one `ModuleLoadResult` per path.
 *
 * @example
 * ```ts
 * const results = await loadProvidersFromModules([
 *   "/plugins/my-provider.ts",
 *   "/plugins/another-provider.ts",
 * ]);
 * const failed = results.filter(r => !r.success);
 * ```
 */
export async function loadProvidersFromModules(
  modulePaths: string[],
  opts: { replace?: boolean } = {},
): Promise<ModuleLoadResult[]> {
  const results: ModuleLoadResult[] = [];

  for (const modulePath of modulePaths) {
    try {
      // Dynamic import — works with Bun's native TS loader
      const mod = await import(modulePath);

      if (!("descriptor" in mod) || mod.descriptor === undefined) {
        results.push({
          path: modulePath,
          success: false,
          error: `Module does not export a "descriptor" named export`,
        });
        continue;
      }

      const descriptor = mod.descriptor as ProviderPluginDescriptor;
      registerProvider(descriptor, opts);

      results.push({
        path: modulePath,
        success: true,
        providerId: descriptor.id,
      });
    } catch (err) {
      results.push({
        path: modulePath,
        success: false,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// resolveProviderAuth — lazy per-tenant auth resolution
// ---------------------------------------------------------------------------

/**
 * Auth resolution result.
 */
export interface ResolvedProviderAuth {
  /** The provider id this resolution is for. */
  providerId: string;
  /**
   * Map of env-var name → resolved value.
   * Present for every required env-var; value is `undefined` when not found in
   * any tier.
   */
  resolved: Record<string, string | undefined>;
  /** Tier that supplied each key: `"env"` | `"opts"` | `"fallback"` | `"missing"`. */
  sources: Record<string, "env" | "opts" | "fallback" | "missing">;
  /** True when every required auth var was resolved to a non-empty value. */
  complete: boolean;
}

/**
 * Options for `resolveProviderAuth`.
 */
export interface ResolveProviderAuthOptions {
  /**
   * Per-request auth bag (e.g. from an incoming HTTP request's headers/body).
   * Keys match the env-var names declared in `authRequired`.
   * Checked after `process.env` but before `fallback`.
   */
  opts?: Record<string, string | undefined>;
  /**
   * Static fallback key bag (e.g. loaded from a secrets manager at startup).
   * Checked last — lowest priority.
   */
  fallback?: Record<string, string | undefined>;
}

/**
 * Resolve auth credentials for a plugin provider in priority order:
 *
 *  1. **`process.env`** — system-level environment variables (highest priority).
 *  2. **`opts`** — per-request key bag (e.g. from HTTP request context).
 *  3. **`fallback`** — static fallback secrets loaded at startup (lowest priority).
 *
 * Only plugin providers registered via `registerProvider` are supported.
 * Built-in providers with `PROVIDER_AUTH` declarations should use their own
 * auth mechanisms.
 *
 * Returns a `ResolvedProviderAuth` object describing what was found and where.
 * Throws `Error` when the provider id is not found in the plugin registry.
 *
 * @example
 * ```ts
 * const auth = resolveProviderAuth("my-source", {
 *   opts: { MY_SOURCE_API_KEY: req.headers["x-api-key"] },
 *   fallback: { MY_SOURCE_API_KEY: process.env.DEFAULT_MY_SOURCE_KEY },
 * });
 * if (!auth.complete) throw new Error("Missing auth for my-source");
 * ```
 */
export function resolveProviderAuth(
  providerId: string,
  options: ResolveProviderAuthOptions = {},
): ResolvedProviderAuth {
  const descriptor = _pluginRegistry.get(providerId);
  if (!descriptor) {
    throw new Error(
      `resolveProviderAuth: provider "${providerId}" is not registered in the plugin registry. ` +
        `Register it first with registerProvider().`,
    );
  }

  const required = descriptor.authRequired ?? [];
  const { opts = {}, fallback = {} } = options;

  const resolved: Record<string, string | undefined> = {};
  const sources: Record<string, "env" | "opts" | "fallback" | "missing"> = {};

  for (const envVar of required) {
    const fromEnv = process.env[envVar];
    if (fromEnv !== undefined && fromEnv !== "") {
      resolved[envVar] = fromEnv;
      sources[envVar] = "env";
      continue;
    }

    const fromOpts = opts[envVar];
    if (fromOpts !== undefined && fromOpts !== "") {
      resolved[envVar] = fromOpts;
      sources[envVar] = "opts";
      continue;
    }

    const fromFallback = fallback[envVar];
    if (fromFallback !== undefined && fromFallback !== "") {
      resolved[envVar] = fromFallback;
      sources[envVar] = "fallback";
      continue;
    }

    resolved[envVar] = undefined;
    sources[envVar] = "missing";
  }

  const complete =
    required.length === 0 || required.every((v) => sources[v] !== "missing");

  return { providerId, resolved, sources, complete };
}

// ---------------------------------------------------------------------------
// Accessors for the plugin registry
// ---------------------------------------------------------------------------

/**
 * Return all descriptors currently registered via `registerProvider`.
 * Does not include built-in providers from `ALL_PROVIDERS`.
 */
export function listPluginProviders(): ProviderPluginDescriptor[] {
  return Array.from(_pluginRegistry.values());
}

/**
 * Return the descriptor for a specific plugin provider, or `undefined`.
 */
export function getPluginProvider(id: string): ProviderPluginDescriptor | undefined {
  return _pluginRegistry.get(id);
}

/**
 * Remove a plugin provider from the plugin registry *and* from the singleton
 * `providerRegistry`.  Returns `true` if it existed.
 */
export function unregisterPluginProvider(id: string): boolean {
  const existed = _pluginRegistry.delete(id);
  providerRegistry.unregister(id);
  return existed;
}

/**
 * Clear all plugin providers (useful in tests).
 * Does not affect built-in providers registered via `bootstrapRegistry()`.
 */
export function _clearPluginRegistry(): void {
  for (const id of Array.from(_pluginRegistry.keys())) {
    _pluginRegistry.delete(id);
    providerRegistry.unregister(id);
  }
}
