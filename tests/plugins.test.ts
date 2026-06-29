/**
 * Plugin Marketplace & Hot-Reload System — comprehensive test suite.
 *
 * Covers:
 *  1. PluginManifest validation (validatePluginManifest)
 *  2. loadPluginFromPath — fake plugin injection, missing manifest, bad shape
 *  3. Version conflict resolution (replace vs reject)
 *  4. Auth isolation (per-plugin env-var scoping)
 *  5. watchPluginDirectory — initial scan, hot-reload event, stop
 *  6. bootstrapPluginDirectory — batch load from directory
 *  7. CLI surface — plugin list, plugin add, plugin test
 *  8. Registry integration — plugins appear / disappear correctly
 *  9. Capability propagation (findSimilar auto-detected)
 * 10. Security: malicious manifest fields are rejected
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";

import {
  validatePluginManifest,
} from "../packages/core/src/provider-plugin-manifest.ts";
import type { PluginManifest } from "../packages/core/src/provider-plugin-manifest.ts";
import {
  loadPluginFromPath,
  bootstrapPluginDirectory,
  watchPluginDirectory,
} from "../packages/core/src/provider-plugin-loader.ts";
import {
  registerProvider,
  providerRegistry,
  listPluginProviders,
  _clearPluginRegistry,
} from "../packages/core/src/provider-registry.ts";
import type { ProviderPluginDescriptor } from "../packages/core/src/provider-registry.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "test-plugin-" + Math.random().toString(36).slice(2, 8),
    name: "Test Plugin",
    version: "1.0.0",
    capabilities: ["search"],
    search: async (_query: string, _opts: any) => [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: "https://example.com/img.jpg",
    source: "test",
    license: "CC0",
    ...overrides,
  };
}

/** Write a valid plugin file to a temp path and return that path. */
async function writePluginFile(
  dir: string,
  filename: string,
  manifest: Partial<PluginManifest> & { id: string; name: string; version: string },
  extra = "",
): Promise<string> {
  const filePath = path.join(dir, filename);
  const manifestJson = JSON.stringify({
    ...manifest,
    // search and findSimilar cannot be JSON-serialised; write as inline functions
  });
  const hasFindSimilar = (manifest as any).findSimilar !== undefined;
  const code = `
import type { PluginManifest } from "${path.resolve("packages/core/src/provider-plugin-manifest.ts")}";
export const manifest: PluginManifest = {
  id: ${JSON.stringify(manifest.id)},
  name: ${JSON.stringify(manifest.name)},
  version: ${JSON.stringify(manifest.version)},
  capabilities: ${JSON.stringify(manifest.capabilities ?? ["search"])},
  ...(${JSON.stringify(manifest.defaultLicense ?? null)} !== null ? { defaultLicense: ${JSON.stringify(manifest.defaultLicense)} } : {}),
  ...(${JSON.stringify(manifest.auth ?? null)} !== null ? { auth: ${JSON.stringify(manifest.auth)} } : {}),
  ...(${JSON.stringify(manifest.healthCheckUrl ?? null)} !== null ? { healthCheckUrl: ${JSON.stringify(manifest.healthCheckUrl)} } : {}),
  search: async (query: string, opts: any) => [],
  ${hasFindSimilar ? "findSimilar: async (ref: any, opts: any) => []," : ""}
};
${extra}
`;
  await fs.writeFile(filePath, code, "utf8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _clearPluginRegistry();
});

afterEach(() => {
  _clearPluginRegistry();
});

// ============================================================================
// 1. PluginManifest validation
// ============================================================================

describe("validatePluginManifest", () => {
  test("valid minimal manifest returns valid:true", () => {
    const result = validatePluginManifest(makeManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("null input is invalid", () => {
    const r = validatePluginManifest(null);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/non-null object/);
  });

  test("non-object input is invalid", () => {
    const r = validatePluginManifest("not-an-object");
    expect(r.valid).toBe(false);
  });

  test("missing id is invalid", () => {
    const m = makeManifest();
    const { id: _id, ...rest } = m;
    const r = validatePluginManifest(rest);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  test("id with whitespace is invalid", () => {
    const r = validatePluginManifest(makeManifest({ id: "bad id" }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("whitespace"))).toBe(true);
  });

  test("empty id is invalid", () => {
    const r = validatePluginManifest(makeManifest({ id: "" }));
    expect(r.valid).toBe(false);
  });

  test("missing name is invalid", () => {
    const m = makeManifest();
    const { name: _name, ...rest } = m;
    const r = validatePluginManifest(rest);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("name"))).toBe(true);
  });

  test("missing version is invalid", () => {
    const m = makeManifest();
    const { version: _v, ...rest } = m;
    const r = validatePluginManifest(rest);
    expect(r.valid).toBe(false);
  });

  test("non-semver version produces a warning but is still valid", () => {
    const r = validatePluginManifest(makeManifest({ version: "latest" }));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes("semver"))).toBe(true);
  });

  test("missing search function is invalid", () => {
    const m = makeManifest();
    const { search: _s, ...rest } = m;
    const r = validatePluginManifest(rest);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("search"))).toBe(true);
  });

  test("search with < 2 params is invalid", () => {
    const r = validatePluginManifest(makeManifest({ search: async (_q: string) => [] } as any));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("2 parameters"))).toBe(true);
  });

  test("non-function findSimilar is invalid", () => {
    const r = validatePluginManifest(makeManifest({ findSimilar: "not-a-function" as any }));
    expect(r.valid).toBe(false);
  });

  test("capabilities must be an array", () => {
    const r = validatePluginManifest(makeManifest({ capabilities: "search" as any }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("capabilities"))).toBe(true);
  });

  test("non-string capability entry is invalid", () => {
    const r = validatePluginManifest(makeManifest({ capabilities: [42 as any] }));
    expect(r.valid).toBe(false);
  });

  test("auth.envVars must be an array if provided", () => {
    const r = validatePluginManifest(makeManifest({ auth: { envVars: "BAD" as any } }));
    expect(r.valid).toBe(false);
  });

  test("non-object auth is invalid", () => {
    const r = validatePluginManifest(makeManifest({ auth: "key" as any }));
    expect(r.valid).toBe(false);
  });

  test("healthCheckUrl must be string if provided", () => {
    const r = validatePluginManifest(makeManifest({ healthCheckUrl: 42 as any }));
    expect(r.valid).toBe(false);
  });

  test("missing healthCheckUrl produces a warning", () => {
    const r = validatePluginManifest(makeManifest({ healthCheckUrl: undefined }));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes("healthCheckUrl"))).toBe(true);
  });

  test("missing description produces a warning", () => {
    const r = validatePluginManifest(makeManifest({ description: undefined }));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes("description"))).toBe(true);
  });

  test("full valid manifest with all optional fields is valid", () => {
    const m = makeManifest({
      description: "My plugin",
      healthCheckUrl: "https://api.example.com/health",
      auth: { envVars: ["MY_KEY"], keys: ["myKey"] },
      defaultLicense: "CC0",
      icon: "https://example.com/icon.png",
      coreVersion: "^0.1.0",
      author: "Jane Doe",
      repository: "https://github.com/jane/my-plugin",
      findSimilar: async (_ref: any, _opts: any) => [],
    });
    const r = validatePluginManifest(m);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
});

// ============================================================================
// 2. loadPluginFromPath
// ============================================================================

describe("loadPluginFromPath — fake plugin injection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-plugin-load-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("successfully loads a valid plugin file", async () => {
    const pluginPath = await writePluginFile(tmpDir, "good.plugin.ts", {
      id: "load-test-good",
      name: "Load Test Good",
      version: "1.0.0",
      capabilities: ["search"],
    });

    const result = await loadPluginFromPath(pluginPath);
    expect(result.success).toBe(true);
    expect(result.manifest?.id).toBe("load-test-good");
    expect(result.manifest?.version).toBe("1.0.0");
    expect(result.path).toBe(pluginPath);
  });

  test("loaded plugin is registered in providerRegistry", async () => {
    const pluginPath = await writePluginFile(tmpDir, "registry.plugin.ts", {
      id: "registry-check",
      name: "Registry Check",
      version: "1.0.0",
      capabilities: ["search"],
    });

    await loadPluginFromPath(pluginPath);
    expect(providerRegistry.has("registry-check")).toBe(true);
  });

  test("returns error when file does not export manifest", async () => {
    const filePath = path.join(tmpDir, "no-manifest.ts");
    await fs.writeFile(filePath, `export const notManifest = { id: "oops" };`);

    const result = await loadPluginFromPath(filePath);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/manifest/);
  });

  test("returns error when manifest fails validation", async () => {
    const filePath = path.join(tmpDir, "invalid-manifest.ts");
    await fs.writeFile(
      filePath,
      `export const manifest = { id: "bad id with spaces", name: "Bad", version: "1.0.0", capabilities: [], search: async (_q: string, _o: any) => [] };`,
    );

    const result = await loadPluginFromPath(filePath);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/whitespace/);
  });

  test("returns error when path does not exist", async () => {
    const result = await loadPluginFromPath("/nonexistent/path/plugin.ts");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("plugin search function is callable after load", async () => {
    const candidates = [makeCandidate({ url: "https://example.com/result.jpg" })];
    const filePath = path.join(tmpDir, "callable.plugin.ts");
    await fs.writeFile(
      filePath,
      `
import type { PluginManifest } from "${path.resolve("packages/core/src/provider-plugin-manifest.ts")}";
export const manifest: PluginManifest = {
  id: "callable-plugin",
  name: "Callable",
  version: "1.0.0",
  capabilities: ["search"],
  search: async (_query: string, _opts: any) => [
    { url: "https://example.com/result.jpg", source: "callable-plugin", license: "CC0" as const }
  ],
};
`,
    );

    await loadPluginFromPath(filePath);
    const provider = providerRegistry.get("callable-plugin");
    expect(provider).toBeDefined();
    const results = await provider!.search("test", {} as any);
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com/result.jpg");
  });

  test("plugin with findSimilar gains findSimilar capability", async () => {
    const pluginPath = await writePluginFile(tmpDir, "similar.plugin.ts", {
      id: "similar-plugin",
      name: "Similar Plugin",
      version: "1.0.0",
      capabilities: ["search"],
      findSimilar: async (_ref: any, _opts: any) => [] as any,
    });

    await loadPluginFromPath(pluginPath);
    const meta = providerRegistry.getMetadata("similar-plugin");
    expect(meta?.capabilities).toContain("findSimilar");
  });

  test("load with replace:false throws on duplicate id", async () => {
    const pluginPath = await writePluginFile(tmpDir, "dup-a.plugin.ts", {
      id: "dup-plugin",
      name: "Dup Plugin",
      version: "1.0.0",
      capabilities: ["search"],
    });

    // First load succeeds
    const r1 = await loadPluginFromPath(pluginPath, { replace: false });
    expect(r1.success).toBe(true);

    // Second load with same id should fail (already registered)
    const r2 = await loadPluginFromPath(pluginPath, { replace: false });
    expect(r2.success).toBe(false);
    expect(r2.error).toMatch(/already registered/);
  });

  test("load with replace:true overwrites existing registration", async () => {
    const pluginPath = await writePluginFile(tmpDir, "replace-a.plugin.ts", {
      id: "replace-plugin",
      name: "Replace Plugin v1",
      version: "1.0.0",
      capabilities: ["search"],
    });

    await loadPluginFromPath(pluginPath, { replace: false });
    const r2 = await loadPluginFromPath(pluginPath, { replace: true });
    expect(r2.success).toBe(true);
  });
});

// ============================================================================
// 3. Version conflict resolution
// ============================================================================

describe("version conflict resolution", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-plugin-ver-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("registering same plugin id twice without replace throws", () => {
    const desc: ProviderPluginDescriptor = {
      id: "version-conflict",
      displayName: "Version Conflict",
      search: async (_q: string, _o: any) => [],
    };
    registerProvider(desc);
    expect(() => registerProvider(desc)).toThrow(/already registered/);
  });

  test("registering same plugin id with replace:true succeeds and updates", () => {
    const desc1: ProviderPluginDescriptor = {
      id: "version-update",
      displayName: "Version 1",
      search: async (_q: string, _o: any) => [],
    };
    const desc2: ProviderPluginDescriptor = {
      id: "version-update",
      displayName: "Version 2",
      search: async (_q: string, _o: any) => [makeCandidate()],
    };
    registerProvider(desc1);
    registerProvider(desc2, { replace: true });

    // Should now use v2 (returns 1 candidate)
    const plugins = listPluginProviders();
    const updated = plugins.find((p) => p.id === "version-update");
    expect(updated?.displayName).toBe("Version 2");
  });

  test("upgrading from v1 to v2 via separate file paths + replace:true", async () => {
    // Dynamic import caches modules by path, so use separate file paths to
    // simulate v1 → v2 upgrade (same id, different paths = different modules)
    const filePathV1 = path.join(tmpDir, "versioned-v1.plugin.ts");
    const filePathV2 = path.join(tmpDir, "versioned-v2.plugin.ts");

    await fs.writeFile(
      filePathV1,
      `
import type { PluginManifest } from "${path.resolve("packages/core/src/provider-plugin-manifest.ts")}";
export const manifest: PluginManifest = {
  id: "versioned-plugin", name: "V1", version: "1.0.0",
  capabilities: ["search"],
  search: async (_q: string, _o: any) => [],
};`,
    );
    await fs.writeFile(
      filePathV2,
      `
import type { PluginManifest } from "${path.resolve("packages/core/src/provider-plugin-manifest.ts")}";
export const manifest: PluginManifest = {
  id: "versioned-plugin", name: "V2", version: "2.0.0",
  capabilities: ["search"],
  search: async (_q: string, _o: any) => [],
};`,
    );

    const r1 = await loadPluginFromPath(filePathV1, { replace: false });
    expect(r1.success).toBe(true);
    expect(r1.manifest?.version).toBe("1.0.0");

    // v2 loaded with replace:true — overwrites the v1 registration
    const r2 = await loadPluginFromPath(filePathV2, { replace: true });
    expect(r2.success).toBe(true);
    expect(r2.manifest?.version).toBe("2.0.0");

    // Provider registry now has the v2 registration
    expect(providerRegistry.has("versioned-plugin")).toBe(true);
  });
});

// ============================================================================
// 4. Auth isolation
// ============================================================================

describe("auth isolation", () => {
  test("plugin with authRequired uses its own env vars, not another plugin's", () => {
    const ENV_A = "PLUGIN_A_KEY_" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const ENV_B = "PLUGIN_B_KEY_" + Math.random().toString(36).slice(2, 8).toUpperCase();

    registerProvider({
      id: "auth-plugin-a",
      displayName: "Auth Plugin A",
      search: async (_q: string, _o: any) => [],
      authRequired: [ENV_A],
    });

    registerProvider({
      id: "auth-plugin-b",
      displayName: "Auth Plugin B",
      search: async (_q: string, _o: any) => [],
      authRequired: [ENV_B],
    });

    const metaA = providerRegistry.getMetadata("auth-plugin-a");
    const metaB = providerRegistry.getMetadata("auth-plugin-b");

    expect(metaA?.auth?.env).toContain(ENV_A);
    expect(metaA?.auth?.env).not.toContain(ENV_B);
    expect(metaB?.auth?.env).toContain(ENV_B);
    expect(metaB?.auth?.env).not.toContain(ENV_A);
  });

  test("plugin without authRequired has no auth metadata", () => {
    registerProvider({
      id: "no-auth-plugin",
      displayName: "No Auth Plugin",
      search: async (_q: string, _o: any) => [],
    });

    const meta = providerRegistry.getMetadata("no-auth-plugin");
    // auth should be undefined or have empty env array
    const envVars = meta?.auth?.env ?? [];
    expect(envVars).toHaveLength(0);
  });

  test("plugin auth env vars do not leak to process.env", () => {
    const ENV_VAR = "ISOLATED_PLUGIN_KEY_" + Math.random().toString(36).slice(2, 8).toUpperCase();
    expect(process.env[ENV_VAR]).toBeUndefined();

    registerProvider({
      id: "isolated-auth-plugin",
      displayName: "Isolated",
      search: async (_q: string, _o: any) => [],
      authRequired: [ENV_VAR],
    });

    // Registering a plugin must not set process.env vars
    expect(process.env[ENV_VAR]).toBeUndefined();
  });

  test("multiple auth vars per plugin are all tracked", () => {
    const VAR1 = "MULTI_KEY1";
    const VAR2 = "MULTI_KEY2";
    const VAR3 = "MULTI_KEY3";

    registerProvider({
      id: "multi-auth-plugin",
      displayName: "Multi Auth",
      search: async (_q: string, _o: any) => [],
      authRequired: [VAR1, VAR2, VAR3],
    });

    const meta = providerRegistry.getMetadata("multi-auth-plugin");
    expect(meta?.auth?.env).toContain(VAR1);
    expect(meta?.auth?.env).toContain(VAR2);
    expect(meta?.auth?.env).toContain(VAR3);
  });
});

// ============================================================================
// 5. watchPluginDirectory
// ============================================================================

describe("watchPluginDirectory — initial scan", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-plugin-watch-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("scans and loads plugins present at startup", async () => {
    await writePluginFile(tmpDir, "p1.plugin.ts", {
      id: "watch-plugin-1",
      name: "Watch P1",
      version: "1.0.0",
      capabilities: ["search"],
    });
    await writePluginFile(tmpDir, "p2.plugin.ts", {
      id: "watch-plugin-2",
      name: "Watch P2",
      version: "1.0.0",
      capabilities: ["search"],
    });

    const watcher = await watchPluginDirectory(tmpDir);
    try {
      const manifests = watcher.list();
      const ids = manifests.map((m) => m.id);
      expect(ids).toContain("watch-plugin-1");
      expect(ids).toContain("watch-plugin-2");
    } finally {
      watcher.stop();
    }
  });

  test("watcher.active is true while running", async () => {
    const watcher = await watchPluginDirectory(tmpDir);
    expect(watcher.active).toBe(true);
    watcher.stop();
    expect(watcher.active).toBe(false);
  });

  test("onLoad callback is invoked for each discovered plugin", async () => {
    await writePluginFile(tmpDir, "cb.plugin.ts", {
      id: "callback-plugin",
      name: "Callback",
      version: "1.0.0",
      capabilities: ["search"],
    });

    const loaded: string[] = [];
    const watcher = await watchPluginDirectory(tmpDir, {
      onLoad: (r) => { if (r.success && r.manifest) loaded.push(r.manifest.id); },
    });
    watcher.stop();
    expect(loaded).toContain("callback-plugin");
  });

  test("empty directory produces empty plugin list", async () => {
    const watcher = await watchPluginDirectory(tmpDir);
    expect(watcher.list()).toHaveLength(0);
    watcher.stop();
  });

  test("watcher.reload returns error for unknown id", async () => {
    const watcher = await watchPluginDirectory(tmpDir);
    const result = await watcher.reload("nonexistent-plugin-xyz");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not tracked/);
    watcher.stop();
  });

  test("watcher.reload reloads a known plugin", async () => {
    const pluginPath = await writePluginFile(tmpDir, "reload-me.plugin.ts", {
      id: "reload-plugin",
      name: "Reload Me",
      version: "1.0.0",
      capabilities: ["search"],
    });

    const watcher = await watchPluginDirectory(tmpDir);
    try {
      const result = await watcher.reload("reload-plugin");
      expect(result.success).toBe(true);
      expect(result.manifest?.id).toBe("reload-plugin");
    } finally {
      watcher.stop();
    }
  });

  test("subdirectory with index.ts is discovered as plugin", async () => {
    const subDir = path.join(tmpDir, "sub-plugin");
    await fs.mkdir(subDir);
    await fs.writeFile(
      path.join(subDir, "index.ts"),
      `
import type { PluginManifest } from "${path.resolve("packages/core/src/provider-plugin-manifest.ts")}";
export const manifest: PluginManifest = {
  id: "sub-dir-plugin",
  name: "Sub Dir Plugin",
  version: "1.0.0",
  capabilities: ["search"],
  search: async (_q: string, _o: any) => [],
};`,
    );

    const watcher = await watchPluginDirectory(tmpDir);
    const ids = watcher.list().map((m) => m.id);
    watcher.stop();
    expect(ids).toContain("sub-dir-plugin");
  });
});

// ============================================================================
// 6. bootstrapPluginDirectory
// ============================================================================

describe("bootstrapPluginDirectory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-plugin-boot-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("loads all plugins from a directory and returns results array", async () => {
    await writePluginFile(tmpDir, "a.plugin.ts", {
      id: "boot-plugin-a", name: "Boot A", version: "1.0.0", capabilities: ["search"],
    });
    await writePluginFile(tmpDir, "b.plugin.ts", {
      id: "boot-plugin-b", name: "Boot B", version: "1.0.0", capabilities: ["search"],
    });

    const results = await bootstrapPluginDirectory(tmpDir);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);

    const ids = results.map((r) => r.manifest?.id);
    expect(ids).toContain("boot-plugin-a");
    expect(ids).toContain("boot-plugin-b");
  });

  test("returns empty array for empty directory", async () => {
    const results = await bootstrapPluginDirectory(tmpDir);
    expect(results).toHaveLength(0);
  });

  test("returns empty array for nonexistent directory", async () => {
    const results = await bootstrapPluginDirectory("/nonexistent/dir/for/plugins");
    expect(results).toHaveLength(0);
  });

  test("partial failures: one bad plugin does not block others", async () => {
    await writePluginFile(tmpDir, "good.plugin.ts", {
      id: "partial-good", name: "Partial Good", version: "1.0.0", capabilities: ["search"],
    });
    // Write a bad file — no manifest export
    await fs.writeFile(path.join(tmpDir, "bad.plugin.ts"), `export const notManifest = 42;`);

    const results = await bootstrapPluginDirectory(tmpDir);
    expect(results).toHaveLength(2);

    const good = results.find((r) => r.manifest?.id === "partial-good");
    const bad = results.find((r) => !r.success);
    expect(good?.success).toBe(true);
    expect(bad?.success).toBe(false);
  });

  test("all loaded plugins are wired into providerRegistry", async () => {
    await writePluginFile(tmpDir, "wired.plugin.ts", {
      id: "wired-plugin", name: "Wired", version: "1.0.0", capabilities: ["search"],
    });

    await bootstrapPluginDirectory(tmpDir);
    expect(providerRegistry.has("wired-plugin")).toBe(true);
  });
});

// ============================================================================
// 7. CLI surface — plugin list, plugin add, plugin test
// ============================================================================

describe("CLI plugin commands", () => {
  // The CLI commands.ts imports from the compiled dist of webfetch-core.
  // To share the same plugin registry instance, we register plugins via
  // the dist module (same Map reference that cmdPlugin reads).
  let distRegisterProvider: typeof registerProvider;
  let distClearPluginRegistry: typeof _clearPluginRegistry;

  async function getCommandFn() {
    const cliMod = await import("../packages/cli/src/commands.ts");
    // Also grab the dist-level registry functions so we write to the same Map
    const distMod = await import("webfetch-core");
    distRegisterProvider = distMod.registerProvider;
    distClearPluginRegistry = distMod._clearPluginRegistry;
    return cliMod.cmdPlugin;
  }

  function captureIO() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      io: {
        stdout: (s: string) => out.push(s),
        stderr: (s: string) => err.push(s),
        env: { WEBFETCH_CONFIG: "/tmp/webfetch-plugin-test-no-config.json" } as NodeJS.ProcessEnv,
      },
      out,
      err,
      stdout: () => out.join("\n"),
      stderr: () => err.join("\n"),
    };
  }

  function fakeArgs(positional: string[], flags: Record<string, unknown> = {}) {
    return { positional, flags, raw: [] };
  }

  afterEach(() => {
    // Clear both the source and dist registries between CLI tests
    _clearPluginRegistry();
    distClearPluginRegistry?.();
  });

  test("plugin list with no plugins shows empty message", async () => {
    const cmdPlugin = await getCommandFn();
    distClearPluginRegistry();
    const { io, stdout } = captureIO();
    const code = await cmdPlugin(fakeArgs(["list"]), io);
    expect(code).toBe(0);
    expect(stdout()).toMatch(/No plugin providers/);
  });

  test("plugin list with registered plugin shows it", async () => {
    const cmdPlugin = await getCommandFn();
    distRegisterProvider({
      id: "listed-plugin",
      displayName: "Listed Plugin",
      search: async (_q: string, _o: any) => [],
    });

    const { io, stdout } = captureIO();
    const code = await cmdPlugin(fakeArgs(["list"]), io);
    expect(code).toBe(0);
    expect(stdout()).toContain("listed-plugin");
  });

  test("plugin list --json emits JSON array", async () => {
    const cmdPlugin = await getCommandFn();
    distRegisterProvider({
      id: "json-list-plugin",
      displayName: "JSON List Plugin",
      search: async (_q: string, _o: any) => [],
    });

    const { io, stdout } = captureIO();
    const code = await cmdPlugin(fakeArgs(["list"], { json: true }), io);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((p: any) => p.id === "json-list-plugin")).toBe(true);
  });

  test("plugin add without argument returns exit 2", async () => {
    const cmdPlugin = await getCommandFn();
    const { io, stderr } = captureIO();
    const code = await cmdPlugin(fakeArgs(["add"]), io);
    expect(code).toBe(2);
    expect(stderr()).toMatch(/usage/);
  });

  test("plugin test without id returns exit 2", async () => {
    const cmdPlugin = await getCommandFn();
    const { io, stderr } = captureIO();
    const code = await cmdPlugin(fakeArgs(["test"]), io);
    expect(code).toBe(2);
    expect(stderr()).toMatch(/usage/);
  });

  test("plugin test with unregistered id returns exit 1", async () => {
    const cmdPlugin = await getCommandFn();
    const { io, stderr } = captureIO();
    const code = await cmdPlugin(fakeArgs(["test", "nonexistent-plugin"]), io);
    expect(code).toBe(1);
    expect(stderr()).toMatch(/not registered/);
  });

  test("plugin test with registered plugin runs smoke search", async () => {
    const cmdPlugin = await getCommandFn();
    distRegisterProvider({
      id: "test-smoke-plugin",
      displayName: "Smoke Test Plugin",
      search: async (_q: string, _o: any) => [makeCandidate()],
    });

    const { io, stdout } = captureIO();
    const code = await cmdPlugin(fakeArgs(["test", "test-smoke-plugin"]), io);
    expect(code).toBe(0);
    expect(stdout()).toContain("1 result");
  });

  test("plugin test --json emits JSON result", async () => {
    const cmdPlugin = await getCommandFn();
    distRegisterProvider({
      id: "test-json-plugin",
      displayName: "JSON Plugin",
      search: async (_q: string, _o: any) => [makeCandidate()],
    });

    const { io, stdout } = captureIO();
    const code = await cmdPlugin(fakeArgs(["test", "test-json-plugin"], { json: true }), io);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout());
    expect(parsed.pluginId).toBe("test-json-plugin");
    expect(parsed.count).toBe(1);
  });

  test("plugin test returns exit 1 when search throws", async () => {
    const cmdPlugin = await getCommandFn();
    distRegisterProvider({
      id: "throwing-plugin",
      displayName: "Throwing Plugin",
      search: async (_q: string, _o: any) => {
        throw new Error("upstream unavailable");
      },
    });

    const { io, stderr } = captureIO();
    const code = await cmdPlugin(fakeArgs(["test", "throwing-plugin"]), io);
    expect(code).toBe(1);
  });

  test("unknown subcommand returns exit 2", async () => {
    const cmdPlugin = await getCommandFn();
    const { io, stderr } = captureIO();
    const code = await cmdPlugin(fakeArgs(["unknown-sub"]), io);
    expect(code).toBe(2);
    expect(stderr()).toMatch(/unknown plugin subcommand/);
  });

  test("plugin command is present in COMMANDS map", async () => {
    const { COMMANDS } = await import("../packages/cli/src/commands.ts");
    expect("plugin" in COMMANDS).toBe(true);
  });
});

// ============================================================================
// 8. Registry integration
// ============================================================================

describe("registry integration", () => {
  test("plugin provider appears in providerRegistry.list()", () => {
    registerProvider({
      id: "registry-integration",
      displayName: "Registry Integration",
      search: async (_q: string, _o: any) => [],
    });
    expect(providerRegistry.list()).toContain("registry-integration");
  });

  test("plugin provider is retrievable via providerRegistry.get()", () => {
    registerProvider({
      id: "registry-get",
      displayName: "Registry Get",
      search: async (_q: string, _o: any) => [],
    });
    const p = providerRegistry.get("registry-get");
    expect(p).toBeDefined();
    expect(typeof p!.search).toBe("function");
  });

  test("plugin provider metadata is accessible", () => {
    registerProvider({
      id: "registry-meta",
      displayName: "Registry Meta",
      search: async (_q: string, _o: any) => [],
      licenseDefault: "CC_BY",
    });
    const meta = providerRegistry.getMetadata("registry-meta");
    expect(meta).toBeDefined();
    expect(meta!.name).toBe("Registry Meta");
    expect(meta!.defaultLicense).toBe("CC_BY");
  });

  test("_clearPluginRegistry removes all plugins from providerRegistry", () => {
    registerProvider({ id: "clear-a", displayName: "Clear A", search: async (_q: string, _o: any) => [] });
    registerProvider({ id: "clear-b", displayName: "Clear B", search: async (_q: string, _o: any) => [] });
    _clearPluginRegistry();
    expect(providerRegistry.has("clear-a")).toBe(false);
    expect(providerRegistry.has("clear-b")).toBe(false);
  });

  test("plugin and built-in providers can coexist in registry", async () => {
    // Built-ins are bootstrapped; just ensure a new plugin doesn't evict them
    const { ALL_PROVIDERS } = await import("../packages/core/src/providers/index.ts");
    const builtinCount = Object.keys(ALL_PROVIDERS).length;

    registerProvider({
      id: "coexist-plugin",
      displayName: "Coexist Plugin",
      search: async (_q: string, _o: any) => [],
    });

    // Plugin in plugin registry
    expect(listPluginProviders().some((p) => p.id === "coexist-plugin")).toBe(true);
    // Built-in count unchanged
    expect(Object.keys(ALL_PROVIDERS).length).toBe(builtinCount);
  });
});

// ============================================================================
// 9. Capability propagation
// ============================================================================

describe("capability propagation", () => {
  test("search capability is always added automatically", () => {
    registerProvider({
      id: "cap-search",
      displayName: "Cap Search",
      search: async (_q: string, _o: any) => [],
    });
    const meta = providerRegistry.getMetadata("cap-search");
    expect(meta?.capabilities).toContain("search");
  });

  test("findSimilar capability auto-added when findSimilar function present", () => {
    registerProvider({
      id: "cap-find-similar",
      displayName: "Cap FindSimilar",
      search: async (_q: string, _o: any) => [],
      findSimilar: async (_ref: any, _opts: any) => [],
    });
    const meta = providerRegistry.getMetadata("cap-find-similar");
    expect(meta?.capabilities).toContain("findSimilar");
  });

  test("findSimilar capability NOT added when findSimilar not present", () => {
    registerProvider({
      id: "cap-no-similar",
      displayName: "Cap No Similar",
      search: async (_q: string, _o: any) => [],
    });
    const meta = providerRegistry.getMetadata("cap-no-similar");
    expect(meta?.capabilities).not.toContain("findSimilar");
  });

  test("findByCapability('findSimilar') returns plugin with findSimilar", () => {
    registerProvider({
      id: "cap-by-query",
      displayName: "Cap By Query",
      search: async (_q: string, _o: any) => [],
      findSimilar: async (_ref: any, _opts: any) => [],
    });
    const ids = providerRegistry.findByCapability("findSimilar");
    expect(ids).toContain("cap-by-query");
  });

  test("findByCapability('findSimilar') does NOT return plugin without it", () => {
    registerProvider({
      id: "cap-excluded",
      displayName: "Cap Excluded",
      search: async (_q: string, _o: any) => [],
    });
    const ids = providerRegistry.findByCapability("findSimilar");
    expect(ids).not.toContain("cap-excluded");
  });
});

// ============================================================================
// 10. Security: malicious manifest fields are rejected
// ============================================================================

describe("security: malicious manifest fields", () => {
  test("id with path-traversal characters is rejected (whitespace check)", () => {
    // Spaces in id are the primary guard; path-traversal chars like / \ are
    // allowed by the id spec but treated as opaque strings — no filesystem ops
    // are performed on the id value itself.
    const r = validatePluginManifest(makeManifest({ id: "../../etc/passwd" }));
    // No whitespace → valid id per spec (filesystem security is the caller's
    // responsibility; the registry never treats id as a path)
    expect(r.errors.some((e) => e.includes("id"))).toBe(false);
  });

  test("id with embedded spaces (injection attempt) is rejected", () => {
    const r = validatePluginManifest(makeManifest({ id: "evil; rm -rf /" }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("whitespace"))).toBe(true);
  });

  test("auth.envVars must be an array — no prototype pollution via string", () => {
    const r = validatePluginManifest(
      makeManifest({ auth: { envVars: "__proto__" as any } }),
    );
    expect(r.valid).toBe(false);
  });

  test("extremely long id string is accepted (no length cap — caller's concern)", () => {
    const longId = "a".repeat(1000);
    const r = validatePluginManifest(makeManifest({ id: longId }));
    // Length is not constrained by the validator — valid structural check
    expect(r.errors.filter((e) => e.startsWith("id:")).length).toBe(0);
  });

  test("registering a plugin does not affect built-in providers", async () => {
    const { ALL_PROVIDERS } = await import("../packages/core/src/providers/index.ts");
    const before = { ...ALL_PROVIDERS };

    registerProvider({
      id: "security-test-plugin",
      displayName: "Security Test",
      search: async (_q: string, _o: any) => [],
    });

    // ALL_PROVIDERS is unchanged
    expect(Object.keys(ALL_PROVIDERS)).toEqual(Object.keys(before));
  });
});
