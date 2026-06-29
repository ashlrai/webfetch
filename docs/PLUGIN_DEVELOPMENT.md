# Plugin Development Guide

Build and ship a custom image-source provider for webfetch without touching core.

## Overview

The webfetch plugin system lets you add third-party image sources — Google Images scrapers, Etsy, ArtStation, custom enterprise image databases — at runtime via a standard `PluginManifest` interface.

Plugins are standalone TypeScript/JavaScript modules that export a `manifest` constant. The host discovers them by path, validates the manifest schema, and wires the plugin into federation automatically.

## Quick Start

### 1. Create your plugin file

```ts
// my-plugin/index.ts
import type { PluginManifest } from "webfetch-core";

export const manifest: PluginManifest = {
  id: "my-image-source",          // unique machine ID, no spaces
  name: "My Image Source",        // display name
  version: "1.0.0",               // semver
  capabilities: ["search"],

  // Required: the search function
  search: async (query, opts) => {
    const resp = await fetch(`https://api.myimagesource.com/search?q=${encodeURIComponent(query)}`);
    const data = await resp.json();
    return data.images.map((img: any) => ({
      url: img.url,
      source: "my-image-source",
      license: "CC0",
      title: img.title,
    }));
  },

  // Optional: metadata
  description: "Search images from My Image Source",
  healthCheckUrl: "https://api.myimagesource.com/health",
  defaultLicense: "CC0",
  auth: {
    envVars: ["MY_IMAGE_SOURCE_API_KEY"],
  },
};
```

### 2. Load it

**One-shot (CLI):**
```sh
webfetch plugin add ./my-plugin/index.ts
```

**Programmatic:**
```ts
import { loadPluginFromPath } from "webfetch-core";

const result = await loadPluginFromPath("./my-plugin/index.ts");
if (!result.success) throw new Error(result.error);
console.log("Loaded:", result.manifest.id);
```

**Directory watch (hot-reload):**
```ts
import { watchPluginDirectory } from "webfetch-core";

const watcher = await watchPluginDirectory("./plugins", {
  onLoad: (r) => console.log(r.success ? `Loaded ${r.manifest?.id}` : `Failed: ${r.error}`),
  onUnload: (id) => console.log(`Unloaded ${id}`),
});

// Later:
watcher.stop();
```

### 3. Verify it

```sh
webfetch plugin list
webfetch plugin test my-image-source
webfetch plugin test my-image-source --query "sunset beach" --json
```

---

## PluginManifest Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✅ | Unique machine ID. No whitespace. |
| `name` | `string` | ✅ | Human-readable display name. |
| `version` | `string` | ✅ | Semver (`"1.0.0"`). |
| `capabilities` | `PluginCapability[]` | ✅ | At minimum `["search"]`. |
| `search` | `function` | ✅ | `(query: string, opts: SearchOptions) => Promise<ImageCandidate[]>` |
| `findSimilar` | `function` | — | `(ref, opts) => Promise<ImageCandidate[]>`. Auto-adds `"findSimilar"` capability. |
| `description` | `string` | — | Short description (≤200 chars). |
| `healthCheckUrl` | `string` | — | URL for health checks (`webfetch plugin test`). |
| `defaultLicense` | `string` | — | Default license tag (e.g. `"CC0"`, `"CC_BY"`). |
| `auth` | `PluginAuth` | — | Auth contract (see below). |
| `icon` | `string` | — | URL/data-URI of a provider icon. |
| `coreVersion` | `string` | — | Semver range of webfetch-core this plugin targets. |
| `author` | `string` | — | Author name/email. |
| `repository` | `string` | — | Plugin repository URL. |

### PluginAuth

```ts
interface PluginAuth {
  envVars?: string[];  // env vars read by the plugin (e.g. ["MY_API_KEY"])
  keys?: string[];     // SearchOptions.auth fields used (e.g. ["myApiKey"])
  scopes?: string[];   // Human-readable permission scopes (for display)
}
```

---

## Template: Full-Featured Provider

```ts
// artstation-plugin/index.ts
import type { PluginManifest, ImageCandidate, SearchOptions } from "webfetch-core";

const BASE_URL = "https://www.artstation.com/api/v2";

async function search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
  const apiKey = opts.auth?.artstationApiKey ?? process.env.ARTSTATION_API_KEY;
  if (!apiKey) {
    console.warn("artstation: ARTSTATION_API_KEY not set — skipping");
    return [];
  }

  const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&type=artwork&page=1&per_page=${opts.maxPerProvider ?? 20}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });

  if (!resp.ok) {
    throw new Error(`artstation: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return (data.data ?? []).map((item: any) => ({
    url: item.cover_url,
    thumbnailUrl: item.smaller_square_cover_url,
    source: "artstation",
    license: "EDITORIAL_LICENSED",
    title: item.title,
    author: item.user?.username,
    sourcePageUrl: `https://www.artstation.com/artwork/${item.hash_id}`,
    width: item.cover_asset?.width,
    height: item.cover_asset?.height,
  } satisfies ImageCandidate));
}

export const manifest: PluginManifest = {
  id: "artstation",
  name: "ArtStation",
  version: "1.0.0",
  capabilities: ["search"],
  description: "Professional digital artwork and concept art from ArtStation.",
  healthCheckUrl: `${BASE_URL}/projects.json?page=1`,
  defaultLicense: "EDITORIAL_LICENSED",
  auth: {
    envVars: ["ARTSTATION_API_KEY"],
  },
  author: "Your Name <you@example.com>",
  repository: "https://github.com/your-org/webfetch-artstation",
  search,
};
```

---

## Template: Plugin with Reverse-Image Search

```ts
import type { PluginManifest, ImageCandidate, SearchOptions } from "webfetch-core";

async function search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
  // ... your search implementation
  return [];
}

async function findSimilar(
  ref: { url?: string; bytes?: Uint8Array },
  opts: SearchOptions,
): Promise<ImageCandidate[]> {
  const imageUrl = ref.url ?? "<upload bytes to get URL>";
  // ... call your reverse-image API
  return [];
}

export const manifest: PluginManifest = {
  id: "my-reverse-search",
  name: "My Reverse Search",
  version: "1.0.0",
  // "findSimilar" is auto-added when findSimilar function is present
  capabilities: ["search"],
  search,
  findSimilar,  // ← makes this provider available via findByCapability("findSimilar")
  healthCheckUrl: "https://api.example.com/health",
};
```

---

## Directory Layout

The watcher expects one of these layouts:

```
plugins/
  my-plugin.plugin.ts          # flat file: must end in .plugin.ts/.js/.mjs
  another-plugin.plugin.ts

  artstation/                  # subdirectory: first match wins
    index.ts                   #   ← loaded as entry point
    helpers.ts

  google-images/
    plugin.ts                  #   ← also works
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `webfetch plugin list` | List all registered plugin providers |
| `webfetch plugin list --json` | JSON output for scripting |
| `webfetch plugin add <path>` | Load a plugin from a local path |
| `webfetch plugin test <id>` | Smoke-test: health check + search("test") |
| `webfetch plugin test <id> --query "sunset"` | Test with custom query |
| `webfetch plugin test <id> --json` | JSON output for assertions |

---

## Programmatic API

```ts
import {
  loadPluginFromPath,       // load single plugin by path
  bootstrapPluginDirectory, // one-shot bulk load from directory
  watchPluginDirectory,     // load + watch for hot-reload
  validatePluginManifest,   // validate manifest shape without loading
  listPluginProviders,      // list all registered plugin descriptors
  registerProvider,         // low-level: register a ProviderPluginDescriptor
  unregisterPluginProvider, // remove a plugin from registry
} from "webfetch-core";
```

### Integration at bootstrap

```ts
import { bootstrapRegistry, bootstrapPluginDirectory } from "webfetch-core";

// 1. Register built-in providers (idempotent)
bootstrapRegistry();

// 2. Load community plugins from a directory
const pluginDir = process.env.WEBFETCH_PLUGINS_DIR ?? path.join(os.homedir(), ".webfetch/plugins");
const results = await bootstrapPluginDirectory(pluginDir, { replace: false });

const failed = results.filter((r) => !r.success);
if (failed.length > 0) {
  console.warn("Plugin load failures:", failed.map((r) => `${r.path}: ${r.error}`));
}
```

---

## Publishing a Plugin

1. **npm package** — name it `webfetch-plugin-<name>` by convention.
2. **Export `manifest`** as a named export from the package entry point.
3. **Declare `peerDependency`** on `webfetch-core`.
4. **Set `coreVersion`** in the manifest to the range you tested against.

```json
{
  "name": "webfetch-plugin-artstation",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "webfetch-core": ">=0.1.0"
  }
}
```

Users install and load it:

```sh
npm install webfetch-plugin-artstation
webfetch plugin add ./node_modules/webfetch-plugin-artstation
```

Or programmatically:

```ts
import { loadPluginFromPath } from "webfetch-core";
await loadPluginFromPath(require.resolve("webfetch-plugin-artstation"));
```

---

## Best Practices

- **Respect `opts.timeoutMs`** — attach an `AbortSignal` so federation can cancel slow requests.
- **Respect `opts.maxPerProvider`** — don't return more results than requested.
- **Return `source: "<your-id>"`** on every `ImageCandidate` so attribution works.
- **Set `healthCheckUrl`** — enables `webfetch plugin test` and circuit-breaker health checks.
- **Handle missing auth gracefully** — return `[]` with a `console.warn` rather than throwing.
- **Declare `auth.envVars`** — lets users discover what keys are needed via `webfetch plugin list`.
- **Use semver** for `version` — enables conflict detection when multiple plugin versions are installed.
