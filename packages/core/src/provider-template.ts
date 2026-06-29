/**
 * Provider Template Factory
 *
 * Scaffolds a new provider module with all required boilerplate: search,
 * optional findSimilar, auth wiring, and rate-limit integration.
 *
 * Usage (generate source code for a new provider):
 *
 *   import { generateProviderTemplate } from "./provider-template.ts";
 *   const code = generateProviderTemplate({
 *     id: "dreamstime",
 *     exportName: "dreamstime",
 *     defaultLicense: "EDITORIAL_LICENSED",
 *     requiresAuth: true,
 *     authKey: "dreamstimeApiKey",
 *     authEnv: "DREAMSTIME_API_KEY",
 *     apiBaseUrl: "https://api.dreamstime.com",
 *     includeFindSimilar: false,
 *   });
 *   console.log(code); // write to providers/dreamstime.ts
 *
 * The returned string is valid TypeScript that conforms to the Provider
 * interface and is immediately usable in the federation layer.
 */

import type { License, ProviderAuth } from "./types.ts";

/** Options controlling what the generated provider module looks like. */
export interface ProviderTemplateOptions {
  /**
   * Provider ID string — must be added to PROVIDER_IDS in types.ts and the
   * rate-limit DEFAULTS map before the generated module will compile cleanly.
   */
  id: string;

  /**
   * The exported variable name (camelCase). E.g. "dreamstime", "depositPhotos".
   * This is what gets imported in providers/index.ts.
   */
  exportName: string;

  /**
   * Default license applied when the API response lacks explicit metadata.
   * Must be a value from the License union in types.ts.
   */
  defaultLicense: License;

  /**
   * Whether the provider requires an API key. When true the generated search()
   * method includes an auth-key read + early-throw guard.
   */
  requiresAuth: boolean;

  /**
   * The ProviderAuth field name (e.g. "dreamstimeApiKey"). Only used when
   * requiresAuth is true. Must be added to ProviderAuth in types.ts.
   */
  authKey?: keyof ProviderAuth;

  /**
   * Corresponding environment-variable name (e.g. "DREAMSTIME_API_KEY").
   * Only used when requiresAuth is true.
   */
  authEnv?: string;

  /** Base URL for the provider API (used to generate fetch call stub). */
  apiBaseUrl: string;

  /**
   * When true, a stubbed findSimilar() method is included in the generated
   * provider. Defaults to false.
   */
  includeFindSimilar?: boolean;

  /**
   * Human-readable description line added to the file header comment.
   * Optional — a generic placeholder is used when omitted.
   */
  description?: string;
}

/**
 * Generates a TypeScript source string for a new provider module.
 *
 * The generated code:
 *  - Imports from the standard core modules (rate-limit, types).
 *  - Implements the Provider interface with correct types.
 *  - Wires auth resolution (opts.auth?.<key> ?? process.env.<ENV>).
 *  - Calls getBucket(id).take() before every outbound request.
 *  - Maps API responses to ImageCandidate with required fields.
 *  - Maps HTTP errors to the correct ErrorKind via thrown Error messages.
 *  - Includes findSimilar stub when includeFindSimilar is true.
 */
export function generateProviderTemplate(opts: ProviderTemplateOptions): string {
  const {
    id,
    exportName,
    defaultLicense,
    requiresAuth,
    authKey,
    authEnv,
    apiBaseUrl,
    includeFindSimilar = false,
    description,
  } = opts;

  const headerComment = `/**
 * ${id} — ${description ?? `provider adapter for ${apiBaseUrl}`}.
 *
 * Generated with generateProviderTemplate() in provider-template.ts.
 * Steps to activate:
 *  1. Add "${id}" to PROVIDER_IDS in types.ts.
 *  2. Add a rate-limit entry to DEFAULTS in rate-limit.ts.
 *  3. Import this file and add it to ALL_PROVIDERS / PROVIDER_AUTH in providers/index.ts.${requiresAuth ? `\n *  4. Add ${authKey} to ProviderAuth in types.ts (if not present).` : ""}
 */`;

  const authBlock = requiresAuth
    ? `    const key = opts.auth?.${authKey} ?? (globalThis as any).process?.env?.${authEnv ?? "MISSING_AUTH_ENV"};
    if (!key) {
      const err = new Error(\`${id}: missing auth key — set ${authEnv ?? authKey}\`);
      // Propagate as ErrorKind "http-4xx" to signal auth failure to federation layer.
      (err as any).errorKind = "http-4xx";
      throw err;
    }`
    : "    // No auth required for this provider.";

  const findSimilarBlock = includeFindSimilar
    ? `
  async findSimilar(
    ref: { url?: string; bytes?: Uint8Array },
    opts: SearchOptions,
  ): Promise<ImageCandidate[]> {
    // TODO: implement reverse-image lookup against ${apiBaseUrl}.
    // Call getBucket("${id}").take() before any outbound request.
    // Map results to ImageCandidate the same way search() does.
    const _ = ref; // suppress unused-var warning until implemented
    const __ = opts;
    return [];
  },`
    : "";

  return `${headerComment}

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const ${exportName}: Provider = {
  id: "${id}" as const,
  defaultLicense: "${defaultLicense}",
  requiresAuth: ${requiresAuth},
${requiresAuth ? `  auth: { keys: ["${authKey}"], env: ["${authEnv ?? ""}"] },\n` : ""}  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
${authBlock}

    // Respect the per-provider token bucket BEFORE making any network call.
    await getBucket("${id}" as any).take();

    const fetcher = opts.fetcher ?? fetch;
    const params = new URLSearchParams({
      q: query,
      per_page: String(opts.maxPerProvider ?? 10),
      // TODO: map safeSearch and licensePolicy to API-specific params.
    });
    const url = \`${apiBaseUrl}/search?\${params}\`;

    let resp: Response;
    try {
      resp = await fetcher(url, {
        headers: {${requiresAuth ? `\n          Authorization: \`Bearer \${key}\`,` : ""}
          "Accept": "application/json",
        },
        signal: opts.signal,
      });
    } catch (err: unknown) {
      // Network-level failure — propagate as ErrorKind "network".
      const e = new Error(\`${id}: network error — \${(err as Error).message}\`);
      (e as any).errorKind = "network";
      throw e;
    }

    if (resp.status === 429) {
      const e = new Error(\`${id}: rate limited (429)\`);
      (e as any).errorKind = "rate-limited";
      throw e;
    }
    if (resp.status >= 500) {
      const e = new Error(\`${id}: server error \${resp.status}\`);
      (e as any).errorKind = "http-5xx";
      throw e;
    }
    if (!resp.ok) {
      const e = new Error(\`${id}: http \${resp.status}\`);
      (e as any).errorKind = "http-4xx";
      throw e;
    }

    let json: any;
    try {
      json = await resp.json();
    } catch (err: unknown) {
      const e = new Error(\`${id}: decode error — \${(err as Error).message}\`);
      (e as any).errorKind = "decode";
      throw e;
    }

    // TODO: replace "results" with the actual top-level key from the API response.
    const items: any[] = json.results ?? [];

    return items.map((item: any): ImageCandidate => ({
      url: item.url ?? item.image_url,
      thumbnailUrl: item.thumbnail_url ?? item.thumb_url,
      width: item.width,
      height: item.height,
      source: "${id}",
      sourcePageUrl: item.page_url ?? item.link,
      title: item.title ?? item.description,
      author: item.author ?? item.photographer,
      license: "${defaultLicense}",
      licenseUrl: item.license_url,
      confidence: 0.8, // TODO: adjust based on metadata completeness.
    }));
  },${findSimilarBlock}
};
`;
}

/**
 * Metadata describing a generated provider for the validation harness.
 *
 * Returned alongside the generated source by generateProviderWithMeta() so
 * callers can inspect structured attributes without parsing the source string.
 */
export interface ProviderTemplateMeta {
  id: string;
  exportName: string;
  defaultLicense: License;
  requiresAuth: boolean;
  authKey?: keyof ProviderAuth;
  authEnv?: string;
  includesFindSimilar: boolean;
  generatedAt: string; // ISO-8601
}

/**
 * Like generateProviderTemplate() but also returns structured metadata that
 * the validation harness and documentation generators can consume.
 */
export function generateProviderWithMeta(opts: ProviderTemplateOptions): {
  source: string;
  meta: ProviderTemplateMeta;
} {
  return {
    source: generateProviderTemplate(opts),
    meta: {
      id: opts.id,
      exportName: opts.exportName,
      defaultLicense: opts.defaultLicense,
      requiresAuth: opts.requiresAuth,
      authKey: opts.authKey,
      authEnv: opts.authEnv,
      includesFindSimilar: opts.includeFindSimilar ?? false,
      generatedAt: new Date().toISOString(),
    },
  };
}
