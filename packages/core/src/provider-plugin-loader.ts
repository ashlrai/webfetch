/**
 * Provider Plugin Loader — runtime discovery and hot-reload.
 *
 * Two entry-points:
 *
 *  - `loadPluginFromPath(path)` — import a single plugin module by absolute
 *    path, validate its `manifest` export, wire it into the provider registry,
 *    and return the manifest.
 *
 *  - `watchPluginDirectory(dir, opts?)` — scan a directory for `*.plugin.ts`
 *    / `*.plugin.js` / `index.ts` entry files, load them all, then start an
 *    `fs.watch` loop for hot-reload. Returns a `PluginWatcher` handle with
 *    `stop()`, `list()`, and `reload(id)` methods.
 *
 * Integration with the provider registry:
 *  - Each loaded plugin is registered via `registerProvider()` using the
 *    `PluginManifest` fields.
 *  - On hot-reload the existing registration is replaced (`{ replace: true }`).
 *  - On removal (file deleted / watcher stopped) the provider is unregistered.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginManifest } from "./provider-plugin-manifest.ts";
import { validatePluginManifest } from "./provider-plugin-manifest.ts";
import { registerProvider, unregisterPluginProvider } from "./provider-registry.ts";
import type { ProviderPluginDescriptor } from "./provider-registry.ts";

// ---------------------------------------------------------------------------
// PluginLoadResult
// ---------------------------------------------------------------------------

/**
 * Result of a single `loadPluginFromPath` call.
 */
export interface PluginLoadResult {
  /** Absolute path that was imported. */
  path: string;
  /** Whether the plugin loaded and registered successfully. */
  success: boolean;
  /** The validated manifest (only set on success). */
  manifest?: PluginManifest;
  /** Error message when loading, validation, or registration failed. */
  error?: string;
  /** Non-fatal warnings from manifest validation. */
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// loadPluginFromPath
// ---------------------------------------------------------------------------

/**
 * Load a single plugin module by absolute (or resolvable) path.
 *
 * The module must export a `manifest` named export satisfying `PluginManifest`.
 * On success, the plugin is wired into the provider registry and its manifest
 * is returned.
 *
 * Errors are returned in the result object — this function never throws.
 *
 * @example
 * ```ts
 * const result = await loadPluginFromPath("/plugins/artstation/index.ts");
 * if (!result.success) console.error("Plugin failed:", result.error);
 * else console.log("Loaded:", result.manifest!.id, result.manifest!.version);
 * ```
 */
export async function loadPluginFromPath(
  pluginPath: string,
  opts: { replace?: boolean } = {},
): Promise<PluginLoadResult> {
  try {
    // Dynamic import — Bun's native TS loader handles .ts paths directly.
    const mod = await import(pluginPath);

    if (!("manifest" in mod) || mod.manifest === undefined) {
      return {
        path: pluginPath,
        success: false,
        error: 'Module does not export a "manifest" named export',
      };
    }

    const validation = validatePluginManifest(mod.manifest);
    if (!validation.valid) {
      return {
        path: pluginPath,
        success: false,
        error: `Invalid manifest: ${validation.errors.join("; ")}`,
        warnings: validation.warnings,
      };
    }

    const manifest = mod.manifest as PluginManifest;

    // Build a ProviderPluginDescriptor from the manifest and register it.
    const descriptor: ProviderPluginDescriptor = {
      id: manifest.id,
      displayName: manifest.name,
      search: manifest.search,
      ...(manifest.findSimilar ? { findSimilar: manifest.findSimilar } : {}),
      ...(manifest.defaultLicense ? { licenseDefault: manifest.defaultLicense } : {}),
      ...(manifest.auth?.envVars?.length ? { authRequired: manifest.auth.envVars } : {}),
    };

    registerProvider(descriptor, { replace: opts.replace ?? false });

    return {
      path: pluginPath,
      success: true,
      manifest,
      warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
    };
  } catch (err) {
    return {
      path: pluginPath,
      success: false,
      error: (err as Error)?.message ?? String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// PluginWatcher
// ---------------------------------------------------------------------------

/**
 * Handle returned by `watchPluginDirectory`.
 */
export interface PluginWatcher {
  /** Stop watching and clean up fs.watch handles. */
  stop(): void;
  /** List all currently loaded plugin manifests. */
  list(): PluginManifest[];
  /**
   * Manually trigger a reload of a specific plugin by id.
   * Returns the new load result.
   */
  reload(pluginId: string): Promise<PluginLoadResult>;
  /** Whether the watcher is currently active. */
  readonly active: boolean;
}

// ---------------------------------------------------------------------------
// Glob helpers — list candidate plugin entry files in a directory
// ---------------------------------------------------------------------------

/**
 * Patterns we consider plugin entry-point filenames (checked in order).
 * A directory whose `basename` looks like `my-plugin` is treated as a single
 * plugin if it contains any of these files.
 */
const ENTRY_FILENAMES = [
  "index.ts",
  "index.js",
  "index.mjs",
  "plugin.ts",
  "plugin.js",
];

/**
 * Return the list of absolute paths to plugin entry files found in `dir`.
 *
 * Strategy:
 *  1. Scan direct children for files matching `*.plugin.ts` / `*.plugin.js`.
 *  2. Scan subdirectories for any of the ENTRY_FILENAMES.
 */
async function discoverPluginPaths(dir: string): Promise<string[]> {
  const paths: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return paths; // directory doesn't exist or isn't readable
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isFile()) {
      // Direct flat plugin file: my-provider.plugin.ts
      if (/\.plugin\.(ts|js|mjs)$/.test(entry.name)) {
        paths.push(full);
      }
    } else if (entry.isDirectory()) {
      // Subdirectory plugin package: my-provider/index.ts
      for (const candidate of ENTRY_FILENAMES) {
        const entryPath = path.join(full, candidate);
        if (fs.existsSync(entryPath)) {
          paths.push(entryPath);
          break; // take the first match per directory
        }
      }
    }
  }

  return paths;
}

// ---------------------------------------------------------------------------
// watchPluginDirectory
// ---------------------------------------------------------------------------

export interface WatchPluginDirectoryOptions {
  /**
   * When true, overwrite already-registered providers of the same id on
   * initial load or hot-reload.  Default: true (hot-reload implies replace).
   */
  replace?: boolean;
  /**
   * Callback invoked whenever a plugin is loaded, reloaded, or fails to load.
   * Use for logging / telemetry.
   */
  onLoad?: (result: PluginLoadResult) => void;
  /**
   * Callback invoked when a plugin file is removed and its provider is
   * unregistered.
   */
  onUnload?: (pluginId: string, filePath: string) => void;
  /**
   * Callback invoked when a watch error occurs (e.g. directory removed).
   */
  onError?: (err: Error) => void;
  /**
   * Debounce window for file-system change events (ms).  Default: 200.
   */
  debounceMs?: number;
}

/**
 * Scan `dir` for plugin entry files, load them all, then watch for changes.
 *
 * Hot-reload behaviour:
 *  - File added    → load and register.
 *  - File changed  → reload and re-register (replace: true).
 *  - File removed  → unregister provider.
 *
 * Returns a `PluginWatcher` handle.  Call `.stop()` to tear down.
 *
 * @example
 * ```ts
 * const watcher = await watchPluginDirectory("/etc/webfetch/plugins", {
 *   onLoad: (r) => console.log("Loaded:", r.manifest?.id),
 *   onUnload: (id) => console.log("Unloaded:", id),
 * });
 * // Later:
 * watcher.stop();
 * ```
 */
export async function watchPluginDirectory(
  dir: string,
  options: WatchPluginDirectoryOptions = {},
): Promise<PluginWatcher> {
  const {
    replace = true,
    onLoad,
    onUnload,
    onError,
    debounceMs = 200,
  } = options;

  // Map from absolute file path → loaded manifest (undefined if failed)
  const loaded = new Map<string, PluginManifest>();
  // Reverse map: plugin id → file path (for reload by id)
  const idToPath = new Map<string, string>();

  let _active = true;
  let _watcher: fs.FSWatcher | null = null;

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------

  const initialPaths = await discoverPluginPaths(dir);
  for (const p of initialPaths) {
    const result = await loadPluginFromPath(p, { replace });
    if (result.success && result.manifest) {
      loaded.set(p, result.manifest);
      idToPath.set(result.manifest.id, p);
    }
    onLoad?.(result);
  }

  // -------------------------------------------------------------------------
  // Hot-reload helpers
  // -------------------------------------------------------------------------

  // Debounce timers keyed by file path
  const _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function handleFileChange(filePath: string): Promise<void> {
    const exists = fs.existsSync(filePath);

    if (!exists) {
      // File removed — unregister
      const manifest = loaded.get(filePath);
      if (manifest) {
        unregisterPluginProvider(manifest.id);
        idToPath.delete(manifest.id);
        loaded.delete(filePath);
        onUnload?.(manifest.id, filePath);
      }
      return;
    }

    // File added or changed — reload
    const result = await loadPluginFromPath(filePath, { replace: true });
    if (result.success && result.manifest) {
      loaded.set(filePath, result.manifest);
      idToPath.set(result.manifest.id, filePath);
    }
    onLoad?.(result);
  }

  function scheduleReload(filePath: string): void {
    const existing = _debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      _debounceTimers.delete(filePath);
      handleFileChange(filePath).catch((err) => onError?.(err as Error));
    }, debounceMs);
    _debounceTimers.set(filePath, timer);
  }

  // -------------------------------------------------------------------------
  // fs.watch setup (best-effort — no-op in environments without native watch)
  // -------------------------------------------------------------------------

  try {
    _watcher = fs.watch(dir, { recursive: false }, (_event, filename) => {
      if (!filename || !_active) return;

      // Determine the full path of the affected file.
      // For subdirectory changes we get just the dirname; try to find the
      // entry file inside it.
      const full = path.join(dir, filename);
      const stat = fs.existsSync(full) ? fs.statSync(full) : null;

      if (stat?.isDirectory()) {
        // Re-scan subdirectory for entry file
        for (const candidate of ENTRY_FILENAMES) {
          const entryPath = path.join(full, candidate);
          if (fs.existsSync(entryPath)) {
            scheduleReload(entryPath);
            return;
          }
        }
        // Entry file was removed — find the previously loaded path inside it
        for (const [loadedPath] of loaded) {
          if (loadedPath.startsWith(full + path.sep)) {
            scheduleReload(loadedPath);
          }
        }
      } else if (
        /\.plugin\.(ts|js|mjs)$/.test(filename) ||
        /^(index|plugin)\.(ts|js|mjs)$/.test(path.basename(filename))
      ) {
        scheduleReload(full);
      }
    });

    _watcher.on("error", (err) => {
      onError?.(err);
    });
  } catch {
    // fs.watch not available (e.g. in some test environments) — skip silently
    _watcher = null;
  }

  // -------------------------------------------------------------------------
  // PluginWatcher handle
  // -------------------------------------------------------------------------

  return {
    get active() {
      return _active;
    },

    stop(): void {
      _active = false;
      for (const timer of _debounceTimers.values()) clearTimeout(timer);
      _debounceTimers.clear();
      _watcher?.close();
      _watcher = null;
    },

    list(): PluginManifest[] {
      return Array.from(loaded.values());
    },

    async reload(pluginId: string): Promise<PluginLoadResult> {
      const filePath = idToPath.get(pluginId);
      if (!filePath) {
        return {
          path: "",
          success: false,
          error: `Plugin "${pluginId}" is not tracked by this watcher`,
        };
      }
      const result = await loadPluginFromPath(filePath, { replace: true });
      if (result.success && result.manifest) {
        loaded.set(filePath, result.manifest);
        idToPath.set(result.manifest.id, filePath);
      }
      onLoad?.(result);
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// bootstrapPluginDirectory — convenience wrapper for startup wiring
// ---------------------------------------------------------------------------

/**
 * One-shot: scan `dir`, load all plugins, wire them into the provider
 * registry, and return the results array.  Does NOT set up a watcher.
 *
 * Useful at application bootstrap when you want plugins loaded without the
 * overhead of file-watching.
 *
 * @example
 * ```ts
 * // In your app bootstrap (e.g. after bootstrapRegistry()):
 * const pluginDir = process.env.WEBFETCH_PLUGINS_DIR ?? "~/.webfetch/plugins";
 * const results = await bootstrapPluginDirectory(pluginDir);
 * const failed = results.filter((r) => !r.success);
 * if (failed.length > 0) console.warn("Plugin load failures:", failed);
 * ```
 */
export async function bootstrapPluginDirectory(
  dir: string,
  opts: { replace?: boolean } = {},
): Promise<PluginLoadResult[]> {
  const paths = await discoverPluginPaths(dir);
  const results: PluginLoadResult[] = [];
  for (const p of paths) {
    results.push(await loadPluginFromPath(p, opts));
  }
  return results;
}
