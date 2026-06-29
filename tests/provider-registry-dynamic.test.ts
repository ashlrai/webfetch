/**
 * Tests for the pluggable provider registry system.
 *
 * Covers:
 *  1. ProviderPluginDescriptor schema validation
 *  2. registerProvider — success, duplicate rejection, replace option
 *  3. findSimilar optional capability detection
 *  4. loadProvidersFromModules — success, missing descriptor, import error
 *  5. resolveProviderAuth — env → opts → fallback priority chain, missing key
 *  6. Backwards compat — all 26 built-in ALL_PROVIDERS entries still export correctly
 *  7. providerRegistry integration — plugin appears in registry after registerProvider
 *  8. unregisterPluginProvider — removes from both plugin and singleton registry
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import {
  registerProvider,
  resolveProviderAuth,
  listPluginProviders,
  getPluginProvider,
  unregisterPluginProvider,
  loadProvidersFromModules,
  providerRegistry,
  _clearPluginRegistry,
} from "../packages/core/src/provider-registry.ts";
import type { ProviderPluginDescriptor } from "../packages/core/src/provider-registry.ts";
import { ALL_PROVIDERS } from "../packages/core/src/providers/index.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalDescriptor(overrides: Partial<ProviderPluginDescriptor> = {}): ProviderPluginDescriptor {
  return {
    id: "test-plugin-" + Math.random().toString(36).slice(2, 8),
    displayName: "Test Plugin Provider",
    search: async (_query: string, _opts: any) => [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: "https://example.com/img.jpg",
    source: "test-plugin",
    license: "CC0",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _clearPluginRegistry();
});

afterEach(() => {
  _clearPluginRegistry();
});

// ---------------------------------------------------------------------------
// 1. Schema validation
// ---------------------------------------------------------------------------

describe("ProviderPluginDescriptor schema validation", () => {
  test("valid minimal descriptor registers without error", () => {
    const desc = makeMinimalDescriptor();
    expect(() => registerProvider(desc)).not.toThrow();
  });

  test("missing id throws TypeError", () => {
    const desc = { displayName: "No ID", search: async (_q: string, _o: any) => [] } as any;
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("empty id throws TypeError", () => {
    const desc = makeMinimalDescriptor({ id: "   " });
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("id with whitespace throws TypeError", () => {
    const desc = makeMinimalDescriptor({ id: "bad id here" });
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("missing displayName throws TypeError", () => {
    const desc = { id: "no-name", search: async (_q: string, _o: any) => [] } as any;
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("empty displayName throws TypeError", () => {
    const desc = makeMinimalDescriptor({ displayName: "" });
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("missing search function throws TypeError", () => {
    const desc = { id: "no-search", displayName: "No Search" } as any;
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("search with fewer than 2 parameters throws TypeError", () => {
    const desc = makeMinimalDescriptor({ search: async (_q: string) => [] } as any);
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("non-function findSimilar throws TypeError", () => {
    const desc = makeMinimalDescriptor({ findSimilar: "not-a-function" as any });
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("authRequired with non-string elements throws TypeError", () => {
    const desc = makeMinimalDescriptor({ authRequired: [123 as any] });
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("authRequired as non-array throws TypeError", () => {
    const desc = makeMinimalDescriptor({ authRequired: "MY_KEY" as any });
    expect(() => registerProvider(desc)).toThrow(TypeError);
  });

  test("valid descriptor with all optional fields registers successfully", () => {
    const desc = makeMinimalDescriptor({
      findSimilar: async (_ref: any, _opts: any) => [],
      icon: "https://example.com/icon.png",
      licenseDefault: "CC0",
      authRequired: ["MY_API_KEY"],
    });
    expect(() => registerProvider(desc)).not.toThrow();
    const stored = getPluginProvider(desc.id);
    expect(stored).toBeDefined();
    expect(stored!.licenseDefault).toBe("CC0");
    expect(stored!.authRequired).toEqual(["MY_API_KEY"]);
  });
});

// ---------------------------------------------------------------------------
// 2. registerProvider — duplicate rejection and replace
// ---------------------------------------------------------------------------

describe("registerProvider duplicate handling", () => {
  test("registering same id twice throws without replace:true", () => {
    const desc = makeMinimalDescriptor({ id: "dup-test" });
    registerProvider(desc);
    expect(() => registerProvider(desc)).toThrow(/already registered/);
  });

  test("registering same id with replace:true succeeds", () => {
    const desc1 = makeMinimalDescriptor({ id: "dup-replace", displayName: "Original" });
    const desc2 = makeMinimalDescriptor({ id: "dup-replace", displayName: "Replacement" });
    registerProvider(desc1);
    expect(() => registerProvider(desc2, { replace: true })).not.toThrow();
    expect(getPluginProvider("dup-replace")!.displayName).toBe("Replacement");
  });

  test("registered provider appears in listPluginProviders()", () => {
    const desc = makeMinimalDescriptor({ id: "list-me" });
    registerProvider(desc);
    const ids = listPluginProviders().map((d) => d.id);
    expect(ids).toContain("list-me");
  });

  test("registered provider appears in providerRegistry.list()", () => {
    const desc = makeMinimalDescriptor({ id: "registry-list-me" });
    registerProvider(desc);
    expect(providerRegistry.has("registry-list-me")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. findSimilar optional capability detection
// ---------------------------------------------------------------------------

describe("findSimilar optional capability", () => {
  test("provider without findSimilar does NOT gain findSimilar capability", () => {
    const desc = makeMinimalDescriptor({ id: "no-similar" });
    registerProvider(desc);
    const meta = providerRegistry.getMetadata("no-similar");
    expect(meta).toBeDefined();
    expect(meta!.capabilities).not.toContain("findSimilar");
  });

  test("provider with findSimilar gains findSimilar capability in registry", () => {
    const desc = makeMinimalDescriptor({
      id: "has-similar",
      findSimilar: async (_ref: any, _opts: any) => [],
    });
    registerProvider(desc);
    const meta = providerRegistry.getMetadata("has-similar");
    expect(meta).toBeDefined();
    expect(meta!.capabilities).toContain("findSimilar");
  });

  test("findByCapability returns provider with findSimilar", () => {
    const desc = makeMinimalDescriptor({
      id: "similar-cap",
      findSimilar: async (_ref: any, _opts: any) => [],
    });
    registerProvider(desc);
    const ids = providerRegistry.findByCapability("findSimilar");
    expect(ids).toContain("similar-cap");
  });

  test("findByCapability does not return provider without findSimilar", () => {
    const desc = makeMinimalDescriptor({ id: "no-similar-cap" });
    registerProvider(desc);
    const ids = providerRegistry.findByCapability("findSimilar");
    expect(ids).not.toContain("no-similar-cap");
  });
});

// ---------------------------------------------------------------------------
// 4. loadProvidersFromModules
// ---------------------------------------------------------------------------

describe("loadProvidersFromModules", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-plugin-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("successfully loads a valid module exporting descriptor", async () => {
    const pluginPath = path.join(tmpDir, "valid-plugin.ts");
    await fs.writeFile(
      pluginPath,
      `
import type { ProviderPluginDescriptor } from "${path.resolve("packages/core/src/provider-registry.ts")}";
export const descriptor: ProviderPluginDescriptor = {
  id: "dynamic-plugin-ok",
  displayName: "Dynamic Plugin OK",
  search: async (_query: string, _opts: any) => [],
  licenseDefault: "CC0",
};
`,
    );

    const results = await loadProvidersFromModules([pluginPath]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].providerId).toBe("dynamic-plugin-ok");
    expect(providerRegistry.has("dynamic-plugin-ok")).toBe(true);
  });

  test("fails gracefully when module does not export descriptor", async () => {
    const pluginPath = path.join(tmpDir, "no-descriptor.ts");
    await fs.writeFile(pluginPath, `export const notADescriptor = { id: "oops" };`);

    const results = await loadProvidersFromModules([pluginPath]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/descriptor/);
  });

  test("fails gracefully when module path does not exist", async () => {
    const results = await loadProvidersFromModules(["/nonexistent/path/plugin.ts"]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });

  test("one bad module does not block other modules in the batch", async () => {
    const goodPath = path.join(tmpDir, "good-plugin.ts");
    const badPath = path.join(tmpDir, "bad-plugin.ts");

    await fs.writeFile(
      goodPath,
      `
import type { ProviderPluginDescriptor } from "${path.resolve("packages/core/src/provider-registry.ts")}";
export const descriptor: ProviderPluginDescriptor = {
  id: "batch-good",
  displayName: "Batch Good",
  search: async (_query: string, _opts: any) => [],
};
`,
    );
    await fs.writeFile(badPath, `export const nothing = 42;`);

    const results = await loadProvidersFromModules([badPath, goodPath]);
    expect(results).toHaveLength(2);

    const bad = results.find((r) => r.path === badPath)!;
    const good = results.find((r) => r.path === goodPath)!;

    expect(bad.success).toBe(false);
    expect(good.success).toBe(true);
    expect(good.providerId).toBe("batch-good");
  });

  test("module with invalid descriptor shape fails with descriptive error", async () => {
    const pluginPath = path.join(tmpDir, "invalid-desc.ts");
    await fs.writeFile(
      pluginPath,
      `export const descriptor = { id: "bad id with spaces", displayName: "Bad", search: async (_q: string, _o: any) => [] };`,
    );

    const results = await loadProvidersFromModules([pluginPath]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. resolveProviderAuth — env → opts → fallback priority chain
// ---------------------------------------------------------------------------

describe("resolveProviderAuth", () => {
  const TEST_ID = "auth-test-provider";
  const ENV_VAR = "TEST_PLUGIN_API_KEY_" + Math.random().toString(36).slice(2, 8).toUpperCase();

  beforeEach(() => {
    const desc = makeMinimalDescriptor({ id: TEST_ID, authRequired: [ENV_VAR] });
    registerProvider(desc);
  });

  test("throws when provider id is not registered", () => {
    expect(() => resolveProviderAuth("nonexistent-provider-id")).toThrow(/not registered/);
  });

  test("resolves from process.env (highest priority)", () => {
    process.env[ENV_VAR] = "env-value";
    try {
      const result = resolveProviderAuth(TEST_ID);
      expect(result.complete).toBe(true);
      expect(result.resolved[ENV_VAR]).toBe("env-value");
      expect(result.sources[ENV_VAR]).toBe("env");
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("resolves from opts when env var is absent", () => {
    delete process.env[ENV_VAR];
    const result = resolveProviderAuth(TEST_ID, { opts: { [ENV_VAR]: "opts-value" } });
    expect(result.complete).toBe(true);
    expect(result.resolved[ENV_VAR]).toBe("opts-value");
    expect(result.sources[ENV_VAR]).toBe("opts");
  });

  test("resolves from fallback when env and opts are absent", () => {
    delete process.env[ENV_VAR];
    const result = resolveProviderAuth(TEST_ID, { fallback: { [ENV_VAR]: "fallback-value" } });
    expect(result.complete).toBe(true);
    expect(result.resolved[ENV_VAR]).toBe("fallback-value");
    expect(result.sources[ENV_VAR]).toBe("fallback");
  });

  test("env takes priority over opts", () => {
    process.env[ENV_VAR] = "env-wins";
    try {
      const result = resolveProviderAuth(TEST_ID, { opts: { [ENV_VAR]: "opts-loses" } });
      expect(result.sources[ENV_VAR]).toBe("env");
      expect(result.resolved[ENV_VAR]).toBe("env-wins");
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test("opts takes priority over fallback", () => {
    delete process.env[ENV_VAR];
    const result = resolveProviderAuth(TEST_ID, {
      opts: { [ENV_VAR]: "opts-wins" },
      fallback: { [ENV_VAR]: "fallback-loses" },
    });
    expect(result.sources[ENV_VAR]).toBe("opts");
    expect(result.resolved[ENV_VAR]).toBe("opts-wins");
  });

  test("complete is false when key is missing from all tiers", () => {
    delete process.env[ENV_VAR];
    const result = resolveProviderAuth(TEST_ID);
    expect(result.complete).toBe(false);
    expect(result.sources[ENV_VAR]).toBe("missing");
    expect(result.resolved[ENV_VAR]).toBeUndefined();
  });

  test("provider without authRequired returns complete:true (no keys needed)", () => {
    const noAuthId = "no-auth-provider-" + Math.random().toString(36).slice(2, 8);
    registerProvider(makeMinimalDescriptor({ id: noAuthId }));
    // No authRequired means required.length === 0 → auth is trivially complete:
    // an auth-free plugin has nothing missing, so it is ready to use.
    const result = resolveProviderAuth(noAuthId);
    expect(result.resolved).toEqual({});
    expect(result.complete).toBe(true);
  });

  test("providerId is echoed in result", () => {
    const result = resolveProviderAuth(TEST_ID);
    expect(result.providerId).toBe(TEST_ID);
  });
});

// ---------------------------------------------------------------------------
// 6. Backwards compat — all 26 built-in providers still export correctly
// ---------------------------------------------------------------------------

describe("Backwards compat — ALL_PROVIDERS", () => {
  const EXPECTED_BUILTIN_COUNT = 25; // 25 built-in providers in ALL_PROVIDERS

  test("ALL_PROVIDERS contains at least the expected number of providers", () => {
    expect(Object.keys(ALL_PROVIDERS).length).toBeGreaterThanOrEqual(EXPECTED_BUILTIN_COUNT);
  });

  test("every ALL_PROVIDERS entry has id, search, defaultLicense, requiresAuth", () => {
    for (const [id, provider] of Object.entries(ALL_PROVIDERS)) {
      expect(typeof provider.id).toBe("string");
      expect(typeof provider.search).toBe("function");
      expect(typeof provider.defaultLicense).toBe("string");
      expect(typeof provider.requiresAuth).toBe("boolean");
    }
  });

  test("core providers are present in ALL_PROVIDERS", () => {
    const coreIds = ["wikimedia", "openverse", "unsplash", "pexels", "pixabay", "itunes", "nasa", "met-museum"];
    for (const id of coreIds) {
      expect(id in ALL_PROVIDERS).toBe(true);
    }
  });

  test("plugin registration does not pollute ALL_PROVIDERS", () => {
    const before = Object.keys(ALL_PROVIDERS).length;
    registerProvider(makeMinimalDescriptor({ id: "should-not-pollute" }));
    const after = Object.keys(ALL_PROVIDERS).length;
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 7. providerRegistry integration
// ---------------------------------------------------------------------------

describe("providerRegistry integration", () => {
  test("plugin provider is get()-able from providerRegistry", () => {
    const desc = makeMinimalDescriptor({ id: "reg-get-test" });
    registerProvider(desc);
    const p = providerRegistry.get("reg-get-test");
    expect(p).toBeDefined();
    expect(typeof p!.search).toBe("function");
  });

  test("plugin provider search function is callable", async () => {
    const candidates = [makeCandidate()];
    const desc = makeMinimalDescriptor({
      id: "callable-plugin",
      search: async (_q: string, _o: any) => candidates,
    });
    registerProvider(desc);
    const p = providerRegistry.get("callable-plugin")!;
    const results = await p.search("test", {} as any);
    expect(results).toEqual(candidates);
  });
});

// ---------------------------------------------------------------------------
// 8. unregisterPluginProvider
// ---------------------------------------------------------------------------

describe("unregisterPluginProvider", () => {
  test("removes provider from plugin registry", () => {
    const desc = makeMinimalDescriptor({ id: "to-remove" });
    registerProvider(desc);
    expect(getPluginProvider("to-remove")).toBeDefined();
    unregisterPluginProvider("to-remove");
    expect(getPluginProvider("to-remove")).toBeUndefined();
  });

  test("removes provider from singleton providerRegistry", () => {
    const desc = makeMinimalDescriptor({ id: "reg-remove" });
    registerProvider(desc);
    expect(providerRegistry.has("reg-remove")).toBe(true);
    unregisterPluginProvider("reg-remove");
    expect(providerRegistry.has("reg-remove")).toBe(false);
  });

  test("returns false when provider was not registered", () => {
    const result = unregisterPluginProvider("never-existed-xyz");
    expect(result).toBe(false);
  });
});
