# Provider Template Guide

This document explains how to use the **Provider Template Factory** to add new image providers to webfetch rapidly, and how the **Provider Validation Harness** catches integration mistakes early.

---

## Why this exists

Adding a new provider (e.g. Dreamstime, Depositphotos, Alamy) required repeating the same boilerplate six times across five files. The template factory generates a complete, contract-compliant provider module from a short configuration object. The validation harness then checks every provider in the registry against the same five-point contract every time `bun test` runs.

---

## Quick start — adding a new provider

### 1. Register the provider ID and rate-limit bucket

**`packages/core/src/types.ts`** — add your id to `PROVIDER_IDS`:

```ts
export const PROVIDER_IDS = [
  // ... existing ids ...
  "dreamstime",
] as const;
```

If the provider needs a new auth field, add it to `ProviderAuth`:

```ts
export interface ProviderAuth {
  // ... existing fields ...
  dreamstimeApiKey?: string;
}
```

**`packages/core/src/rate-limit.ts`** — add a bucket entry to `DEFAULTS`:

```ts
const DEFAULTS: Record<ProviderId, { capacity: number; perSec: number }> = {
  // ... existing entries ...
  dreamstime: { capacity: 2, perSec: 2 },
};
```

### 2. Generate the provider module

```ts
import { generateProviderTemplate } from "webfetch-core/provider-template";

const source = generateProviderTemplate({
  id: "dreamstime",
  exportName: "dreamstime",
  defaultLicense: "EDITORIAL_LICENSED",
  requiresAuth: true,
  authKey: "dreamstimeApiKey",
  authEnv: "DREAMSTIME_API_KEY",
  apiBaseUrl: "https://api.dreamstime.com",
  description: "Dreamstime stock photo search — editorial licensed",
  includeFindSimilar: false,
});

// Write to packages/core/src/providers/dreamstime.ts
import { writeFileSync } from "node:fs";
writeFileSync("packages/core/src/providers/dreamstime.ts", source);
```

Or, for structured metadata alongside the source:

```ts
import { generateProviderWithMeta } from "webfetch-core/provider-template";

const { source, meta } = generateProviderWithMeta({ /* same options */ });
console.log(meta.generatedAt); // ISO-8601 timestamp
```

### 3. Wire it up in the providers index

**`packages/core/src/providers/index.ts`**:

```ts
import { dreamstime } from "./dreamstime.ts";

export const ALL_PROVIDERS: Record<ProviderId, Provider> = {
  // ... existing providers ...
  dreamstime,
};

export const PROVIDER_AUTH: Partial<Record<ProviderId, ProviderAuthRequirement>> = {
  // ... existing entries ...
  dreamstime: { keys: ["dreamstimeApiKey"], env: ["DREAMSTIME_API_KEY"] },
};
```

### 4. Implement the TODO sections in the generated file

The generator scaffolds three stubs that you fill in with real API logic:

| Location in generated file | What to do |
|---|---|
| `URLSearchParams` block | Map `safeSearch` and `licensePolicy` to API query params |
| `json.results` mapping | Replace with the actual top-level key from the API response |
| `ImageCandidate` fields | Map API fields to the correct candidate properties |

### 5. Run the validation harness

```bash
bun test packages/core/src/provider-validator.test.ts
```

All five contract checks run automatically for every provider in `ALL_PROVIDERS`. Fix any failures before submitting a PR.

---

## Template options reference

| Option | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Provider ID (must match `PROVIDER_IDS` entry) |
| `exportName` | `string` | Yes | camelCase export name used in providers/index.ts |
| `defaultLicense` | `License` | Yes | Fallback license when API metadata is missing |
| `requiresAuth` | `boolean` | Yes | Whether an API key is needed |
| `authKey` | `keyof ProviderAuth` | When `requiresAuth: true` | Field name in `ProviderAuth` interface |
| `authEnv` | `string` | When `requiresAuth: true` | Environment variable name |
| `apiBaseUrl` | `string` | Yes | Base URL for the provider API |
| `includeFindSimilar` | `boolean` | No | Include a `findSimilar()` stub (default: `false`) |
| `description` | `string` | No | Human-readable description for the file header |

---

## Validation harness — what it checks

The harness in `packages/core/src/provider-validator.test.ts` runs five contract checks against every provider in `ALL_PROVIDERS`:

### Check 1 — Required interface methods exist

Every provider must export:
- `id: ProviderId` — string, matching the registry key
- `defaultLicense: License` — valid License tag
- `requiresAuth: boolean`
- `search(query, opts): Promise<ImageCandidate[]>` — function

`findSimilar` is optional but, when present, must be a function.

### Check 2 — License tags are in `PROVIDER_LICENSES` (LICENSE_RANK keys)

`defaultLicense` must be one of the values in `LICENSE_RANK`. Any unrecognised tag is caught at test time rather than silently returning `UNKNOWN` results at runtime.

### Check 3 — Error handling propagates via ErrorKind

Generated provider source must include `errorKind` annotations on all failure paths:
- `"http-4xx"` — auth failure or client error
- `"network"` — fetch threw (connection refused, DNS failure, etc.)
- `"rate-limited"` — HTTP 429
- `"http-5xx"` — server error
- `"decode"` — JSON parse failure

The harness verifies this with both static source inspection (for generated providers) and live mock-fetch tests for all five paths.

### Check 4 — Rate-limit bucket is registered

`getBucket(id)` must not throw for every provider ID. This ensures the `DEFAULTS` map in `rate-limit.ts` is kept in sync with `PROVIDER_IDS`.

### Check 5 — Auth keys match PROVIDER_AUTH registry

When `provider.requiresAuth === true`, the provider must have a corresponding entry in `PROVIDER_AUTH`. When `provider.auth` is set, its `keys` and `env` arrays must exactly match the `PROVIDER_AUTH` entry. This prevents silent auth-skip mismatches in federation.

---

## Error handling conventions

All provider errors must carry an `errorKind` property on the thrown `Error`. Federation and reporting layers use this to route failures correctly:

```ts
// In your search() implementation:
if (resp.status === 429) {
  const e = new Error(`${id}: rate limited`);
  (e as any).errorKind = "rate-limited";
  throw e;
}
```

The generated template scaffolds all five paths automatically. Do not remove them when filling in the API-specific logic.

---

## Adding `findSimilar`

Pass `includeFindSimilar: true` to include a stub. The stub returns an empty array until you implement it:

```ts
async findSimilar(ref, opts) {
  await getBucket("dreamstime" as any).take();
  // POST ref.url or ref.bytes to the provider's reverse-image endpoint
  // and map results the same way search() does.
  return [];
}
```

Not all providers expose reverse-image search. Only set `includeFindSimilar: true` when the API supports it.

---

## Candidate providers ready to add

The following providers are well-known stock image sources that the template can scaffold immediately. Each needs the four registration steps above plus filling in the API-specific TODO sections:

| Provider | Auth Needed | License | Notes |
|---|---|---|---|
| Dreamstime | API key | `EDITORIAL_LICENSED` | Large microstock library |
| Depositphotos | API key | `EDITORIAL_LICENSED` | Strong CC collection subset |
| Alamy | API key | `EDITORIAL_LICENSED` + CC subset | High-quality editorial |
| Getty Images | API key | `EDITORIAL_LICENSED` | Premium editorial |
| Shutterstock | API key | `EDITORIAL_LICENSED` | Large stock library |
| StockSnap | None | `CC0` | Free CC0 photos |
| Reshot | None | `CC0` | Free CC0 photos |
| Gratisography | None | `CC0` | Quirky free photos |
