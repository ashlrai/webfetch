/**
 * Subcommand implementations. Exported so `tests/cli.test.ts` can dispatch
 * them directly and assert structured output without shelling out.
 *
 * Convention: every command resolves to a numeric exit code. "No results"
 * is exit 0 with a friendly message. Usage errors are exit 2. Unexpected
 * failures (thrown) bubble up to the top-level catch in index.ts.
 */

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { FederationRepairPlan, FederationPhashAuditReport, ImageCandidate, PhashDiagnosticsResult, ProviderId, SearchOptions, SearchResultBundle, ExportFormat, ProviderSelectionMode, BatchReverseImageOutput, BatchConflictAuditResult, BatchConflictResolutionResult, MetadataProvenanceExport } from "webfetch-core";
import { analyzePhashQuality, auditLicenseConflictBatch, batchReverseImageSearch, buildFederationPhashAuditReport, getCacheAnalyticsSnapshot, getFederationRepairPlan, providerRegistry, exportImageMetadata, loadPluginFromPath, listPluginProviders, reconcileLicenseConflictsBatch, generateDeduplicationReport, exportClusteringMetrics, predictCacheHits, DEFAULT_PROVIDERS, buildMetadataProvenanceExport, formatProvenanceReport } from "webfetch-core";
import type { CacheHitPrediction } from "webfetch-core";
import { type ParsedArgs, getBool, getInt, getString, parseArgs } from "./args.ts";
import {
  BUILTIN_DEFAULTS,
  type ResolvedConfig,
  type ResolvedDefaults,
  defaultConfigPath,
  expandHome,
  loadResolved,
  setConfigValue,
  writeStarterConfig,
} from "./config.ts";
import { core } from "./core.ts";
import { c, formatBytes, licenseColor, renderTable } from "./format.ts";
import { cloudRequest } from "./http.ts";
import { promptChoice, renderCandidateTable } from "./picker.ts";
import { authFromEnv, listProviders, missingAuthWarnings } from "./providers.ts";
import {
  diffNew,
  mergeState,
  parseInterval,
  readState,
  watchStatePath,
  writeState,
} from "./watch.ts";
import { writeSidecar } from "./xmp.ts";
import { cmdWarm } from "./commands/warm.ts";

export interface CommandIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env?: NodeJS.ProcessEnv;
  /** Test hook: injected stdin reader for the picker. */
  readKey?: () => Promise<string>;
  /** Test hook: explicit TTY override. */
  isTTY?: boolean;
  /** Test hook: stdin source for batch mode (async iterable of lines). */
  readStdin?: () => AsyncIterable<string>;
  /** Test hook: tick override for watch mode. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_IO: CommandIO = {
  stdout: (s) => process.stdout.write(`${s}\n`),
  stderr: (s) => process.stderr.write(`${s}\n`),
  env: process.env,
};

function normalizeLicense(v: string | undefined): SearchOptions["licensePolicy"] | undefined {
  if (!v) return undefined;
  if (v === "open" || v === "open-only") return "open-only";
  if (v === "context" || v === "context-safe") return "context-safe";
  if (v === "any") return "any";
  if (v === "prefer" || v === "prefer-safe") return "prefer-safe";
  if (v === "safe" || v === "safe-only") return "safe-only";
  return undefined;
}

async function resolveCliConfig(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<ResolvedConfig> {
  const profile = getString(args.flags, "profile");
  return await loadResolved({ profile, env });
}

function buildSearchOptions(
  args: ParsedArgs,
  env: NodeJS.ProcessEnv,
  cfg: ResolvedConfig,
): {
  opts: SearchOptions;
  limit: number;
  verbose: boolean;
  json: boolean;
  providers?: ProviderId[];
} {
  const providersFlag = getString(args.flags, "providers", "p");
  const envProviders = env.WEBFETCH_PROVIDERS;
  const providers: ProviderId[] | undefined = providersFlag
    ? (providersFlag
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as ProviderId[])
    : envProviders
      ? (envProviders
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean) as ProviderId[])
      : cfg.providers;

  const licensePolicy =
    normalizeLicense(getString(args.flags, "license")) ??
    normalizeLicense(env.WEBFETCH_LICENSE) ??
    normalizeLicense(cfg.license as string | undefined) ??
    "safe-only";

  const minWidth =
    getInt(args.flags, "min-width") ??
    (env.WEBFETCH_MIN_WIDTH ? Number.parseInt(env.WEBFETCH_MIN_WIDTH, 10) : undefined) ??
    cfg.minWidth;
  const minHeight =
    getInt(args.flags, "min-height") ??
    (env.WEBFETCH_MIN_HEIGHT ? Number.parseInt(env.WEBFETCH_MIN_HEIGHT, 10) : undefined) ??
    cfg.minHeight;
  const maxPerProvider = getInt(args.flags, "max-per-provider") ?? cfg.maxPerProvider;

  const limit =
    getInt(args.flags, "limit", "n") ??
    (env.WEBFETCH_LIMIT ? Number.parseInt(env.WEBFETCH_LIMIT, 10) : undefined) ??
    cfg.limit ??
    BUILTIN_DEFAULTS.limit!;

  // --provider-selection [default|quality|latency|balance]
  const rawSelection = getString(args.flags, "provider-selection");
  const scorecardSelection: ProviderSelectionMode | undefined =
    rawSelection === "quality" || rawSelection === "latency" || rawSelection === "balance"
      ? rawSelection
      : rawSelection === "default"
        ? "default"
        : undefined;

  const semanticDedupe = getBool(args.flags, "semantic-dedupe");

  // --phash-dedup is ON by default; --no-phash-dedup or WEBFETCH_PHASH_DEDUP=0 disables it.
  // We only explicitly set phashDedup:false when the user wants to disable; otherwise
  // federation.ts respects the default (true) so we don't need to set true explicitly.
  const noPhashDedup =
    getBool(args.flags, "no-phash-dedup") ||
    env.WEBFETCH_PHASH_DEDUP === "0";

  return {
    opts: {
      providers,
      licensePolicy,
      maxPerProvider,
      minWidth,
      minHeight,
      timeoutMs: getInt(args.flags, "timeout-ms"),
      auth: authFromEnv(env),
      dryRun: getBool(args.flags, "dry-run"),
      ...(scorecardSelection !== undefined ? { scorecardSelection } : {}),
      ...(semanticDedupe ? { semanticDedupe: true } : {}),
      ...(noPhashDedup ? { phashDedup: false } : {}),
    },
    limit,
    verbose: getBool(args.flags, "verbose"),
    json: getBool(args.flags, "json"),
    providers,
  };
}

function wantsCloud(args: ParsedArgs, env: NodeJS.ProcessEnv): boolean {
  return getBool(args.flags, "cloud") || env.WEBFETCH_MODE === "cloud";
}

function searchBody(query: string, opts: SearchOptions): Record<string, unknown> {
  return {
    query,
    providers: opts.providers,
    safeSearch: opts.safeSearch,
    licensePolicy: opts.licensePolicy,
    maxPerProvider: opts.maxPerProvider,
    minWidth: opts.minWidth,
    minHeight: opts.minHeight,
    timeoutMs: opts.timeoutMs,
    dryRun: opts.dryRun,
  };
}

function emitBundle(
  bundle: SearchResultBundle,
  opts: { json: boolean; limit: number; verbose: boolean },
  io: CommandIO,
): number {
  const { candidates, warnings, providerReports } = bundle;
  const sliced = candidates.slice(0, opts.limit);

  if (opts.json) {
    io.stdout(JSON.stringify(sliced, null, 2));
    return 0;
  }

  if (opts.verbose) {
    for (const w of warnings) io.stderr(c.yellow(`warning: ${w}`));
    for (const r of providerReports) {
      if (r.ok) {
        io.stderr(c.dim(`  ${r.provider}: ${r.count} results in ${r.timeMs}ms`));
      } else {
        const why = r.skipped ?? r.error ?? "failed";
        io.stderr(c.dim(`  ${r.provider}: ${why}`));
      }
    }
  }

  if (sliced.length === 0) {
    io.stdout(c.yellow("No results."));
    if (!opts.verbose && warnings.length > 0) {
      io.stdout(c.dim("(re-run with --verbose to see provider warnings)"));
    }
    return 0;
  }

  io.stdout(renderCandidateTable(sliced));
  io.stdout("");
  io.stdout(
    c.dim(
      `${sliced.length} of ${candidates.length} shown. Use --json for full records or 'webfetch download <url>' to fetch.`,
    ),
  );
  return 0;
}

function shouldPick(args: ParsedArgs, io: CommandIO): boolean {
  if (!getBool(args.flags, "pick")) return false;
  const tty = io.isTTY ?? !!process.stdout.isTTY;
  return tty && !getBool(args.flags, "json");
}

function resolveExportFormat(args: ParsedArgs): ExportFormat | undefined {
  const raw = getString(args.flags, "export-format");
  if (!raw) return undefined;
  if (raw === "xmp" || raw === "exif" || raw === "json" || raw === "all") return raw as ExportFormat;
  return "xmp"; // default on unrecognised value
}

async function downloadCandidate(
  cand: ImageCandidate,
  args: ParsedArgs,
  env: NodeJS.ProcessEnv,
  cfg: ResolvedConfig,
  io: CommandIO,
): Promise<void> {
  const outDir = getString(args.flags, "out-dir") ?? expandHome(cfg.outDir, env);
  const maxBytes = getInt(args.flags, "max-bytes");
  const r = await core().downloadImage(cand.url, { maxBytes });
  let finalPath = r.cachedPath;
  if (outDir) {
    const fname = basename(new URL(cand.url).pathname) || `image-${r.sha256.slice(0, 8)}`;
    finalPath = resolve(outDir, fname);
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(finalPath, r.bytes);
  }
  const wantsSidecar = cfg.sidecar !== false && !getBool(args.flags, "no-sidecar");
  let sidecar: string | undefined;
  if (wantsSidecar) {
    const exportFormat = resolveExportFormat(args) ?? "xmp";
    const exportResult = await exportImageMetadata(finalPath, cand, r.bytes, {
      format: exportFormat,
      downloadedAt: new Date().toISOString(),
      mime: r.mime,
      sha256: r.sha256,
    });
    sidecar = exportResult.xmpPath ?? exportResult.jsonPath;
  }
  io.stdout(
    `${c.green("Saved:")} ${finalPath} ${c.dim(`(${formatBytes(r.bytes.byteLength)}, ${r.mime})`)}${sidecar ? c.dim(` +sidecar ${sidecar}`) : ""}`,
  );
}

async function maybePick(
  bundle: SearchResultBundle,
  args: ParsedArgs,
  env: NodeJS.ProcessEnv,
  cfg: ResolvedConfig,
  io: CommandIO,
  limit: number,
): Promise<number> {
  const cands = bundle.candidates.slice(0, limit);
  if (cands.length === 0) {
    io.stdout(c.yellow("No results."));
    return 0;
  }
  io.stdout(renderCandidateTable(cands));
  io.stdout("");
  const choice = await promptChoice(cands.length, {
    stdout: io.stdout,
    stderr: io.stderr,
    readKey: io.readKey,
  });
  if (choice.kind === "quit") return 0;
  if (choice.kind === "pick") {
    await downloadCandidate(cands[choice.index]!, args, env, cfg, io);
    return 0;
  }
  for (const cand of cands) {
    await downloadCandidate(cand, args, env, cfg, io);
  }
  return 0;
}

export async function cmdSearch(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(c.red("usage: webfetch search <query> [flags]"));
    return 2;
  }
  const cfg = await resolveCliConfig(args, env);
  const { opts, limit, verbose, json } = buildSearchOptions(args, env, cfg);
  if (verbose && opts.providers) {
    for (const w of missingAuthWarnings(opts.providers, env)) io.stderr(c.yellow(`warning: ${w}`));
  }
  const bundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/search", { body: searchBody(query, opts) })
    : await core().searchImages(query, opts);
  if (shouldPick(args, io)) return maybePick(bundle, args, env, cfg, io, limit);
  const exitCode = emitBundle(bundle, { json, limit, verbose }, io);
  // --phash-diagnostics: append diagnostics summary after normal results
  if (getBool(args.flags, "phash-diagnostics")) {
    const diag = analyzePhashQuality(bundle.candidates);
    io.stdout("");
    emitPhashDiagnostics(diag, json, io);
  }
  return exitCode;
}

export async function cmdArtist(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const name = args.positional.join(" ").trim();
  const kind = (getString(args.flags, "kind", "k") ?? "portrait") as any;
  if (!name) {
    io.stderr(c.red("usage: webfetch artist <name> [--kind portrait|album|logo|performing]"));
    return 2;
  }
  if (!["portrait", "album", "logo", "performing"].includes(kind)) {
    io.stderr(c.red(`invalid --kind: ${kind} (expected portrait|album|logo|performing)`));
    return 2;
  }
  const cfg = await resolveCliConfig(args, env);
  const { opts, limit, verbose, json } = buildSearchOptions(args, env, cfg);
  const bundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/artist", { body: { ...searchBody(name, opts), artist: name, kind } })
    : await core().searchArtistImages(name, kind, opts);
  if (shouldPick(args, io)) return maybePick(bundle, args, env, cfg, io, limit);
  return emitBundle(bundle, { json, limit, verbose }, io);
}

export async function cmdAlbum(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  if (args.positional.length < 2) {
    io.stderr(c.red('usage: webfetch album "<artist>" "<album>"'));
    return 2;
  }
  const artist = args.positional[0]!;
  const album = args.positional.slice(1).join(" ");
  const cfg = await resolveCliConfig(args, env);
  const { opts, limit, verbose, json } = buildSearchOptions(args, env, cfg);
  const bundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/album", { body: { ...searchBody(`${artist} ${album}`, opts), artist, album } })
    : await core().searchAlbumCover(artist, album, opts);
  if (shouldPick(args, io)) return maybePick(bundle, args, env, cfg, io, limit);
  return emitBundle(bundle, { json, limit, verbose }, io);
}

export async function cmdDownload(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const url = args.positional[0];
  if (!url) {
    io.stderr(c.red("usage: webfetch download <url> [--out path] [--max-bytes N]"));
    return 2;
  }
  const cfg = await resolveCliConfig(args, env);
  const out = getString(args.flags, "out", "o");
  const maxBytes = getInt(args.flags, "max-bytes");
  const json = getBool(args.flags, "json");

  if (wantsCloud(args, env)) {
    const rec = await cloudRequest<Record<string, unknown>>(cfg, "/download", {
      body: { url, maxBytes, cacheDir: cfg.outDir ? expandHome(cfg.outDir, env) : undefined },
    });
    if (json) io.stdout(JSON.stringify(rec, null, 2));
    else io.stdout(`${c.green("Saved:")} ${String(rec.path ?? rec.cachedPath ?? url)}`);
    return 0;
  }

  const r = await core().downloadImage(url, { maxBytes });
  let finalPath = r.cachedPath;
  if (out) {
    finalPath = resolve(out);
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(finalPath, r.bytes);
  } else if (cfg.outDir) {
    const baseName = basename(new URL(url).pathname) || `image-${r.sha256.slice(0, 8)}`;
    finalPath = resolve(expandHome(cfg.outDir, env)!, baseName);
    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(finalPath, r.bytes);
  }

  const wantsSidecar = cfg.sidecar !== false && !getBool(args.flags, "no-sidecar");
  let sidecarPath: string | undefined;
  if (wantsSidecar) {
    const exportFormat = resolveExportFormat(args) ?? "xmp";
    const cand: ImageCandidate = {
      url,
      source: (r as any).source ?? "unknown",
      license: (r as any).license ?? "UNKNOWN",
      author: (r as any).author,
      attributionLine: (r as any).attributionLine,
      sourcePageUrl: (r as any).sourcePageUrl,
      licenseUrl: (r as any).licenseUrl,
      title: (r as any).title,
    };
    const exportResult = await exportImageMetadata(finalPath, cand, r.bytes, {
      format: exportFormat,
      downloadedAt: new Date().toISOString(),
      mime: r.mime,
      sha256: r.sha256,
    });
    sidecarPath = exportResult.xmpPath ?? exportResult.jsonPath;
  }

  const rec = {
    url,
    path: finalPath,
    bytes: r.bytes.byteLength,
    mime: r.mime,
    sha256: r.sha256,
    cachedPath: r.cachedPath,
    sidecar: sidecarPath,
  };
  if (json) {
    io.stdout(JSON.stringify(rec, null, 2));
  } else {
    io.stdout(
      `${c.green("Saved:")} ${finalPath} ${c.dim(`(${formatBytes(r.bytes.byteLength)}, sha256 ${r.sha256.slice(0, 12)}\u2026, mime ${r.mime})`)}${sidecarPath ? c.dim(` +sidecar ${sidecarPath}`) : ""}`,
    );
  }
  return 0;
}

export async function cmdProbe(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const url = args.positional[0];
  if (!url) {
    io.stderr(c.red("usage: webfetch probe <url> [--json]"));
    return 2;
  }
  const json = getBool(args.flags, "json");
  const cfg = await resolveCliConfig(args, env);
  const r = wantsCloud(args, env)
    ? await cloudRequest<any>(cfg, "/probe", { body: { url } })
    : await core().probePage(url);
  if (json) {
    io.stdout(JSON.stringify(r, null, 2));
    return 0;
  }
  const imgs = (r as any).images ?? [];
  if (imgs.length === 0) {
    io.stdout(c.yellow("No images found on page."));
    return 0;
  }
  const cols = [
    { header: "#", width: 3, align: "right" as const },
    { header: "license", width: 10 },
    { header: "dims", width: 11 },
    { header: "url", width: 64 },
  ];
  const rows = imgs.map((im: any, i: number) => [
    String(i + 1),
    licenseColor(im.license ?? "UNKNOWN")(shortLicense(im.license ?? "UNKNOWN")),
    im.width && im.height ? `${im.width}x${im.height}` : "?",
    im.url,
  ]);
  io.stdout(renderTable(cols, rows));
  return 0;
}

function shortLicense(lic: string): string {
  return lic
    .replace("PUBLIC_DOMAIN", "PD")
    .replace("UNSPLASH_LICENSE", "UNSPLASH")
    .replace("PEXELS_LICENSE", "PEXELS")
    .replace("PIXABAY_LICENSE", "PIXABAY")
    .replace("EDITORIAL_LICENSED", "EDITORIAL")
    .replace("PRESS_KIT_ALLOWLIST", "PRESSKIT");
}

export async function cmdLicense(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const url = args.positional[0];
  if (!url) {
    io.stderr(c.red("usage: webfetch license <url> [--probe] [--json]"));
    return 2;
  }
  const probe = getBool(args.flags, "probe");
  const json = getBool(args.flags, "json");
  const cfg = await resolveCliConfig(args, env);
  const r = wantsCloud(args, env)
    ? await cloudRequest<any>(cfg, "/license", { body: { url, probe } })
    : await core().fetchWithLicense(url, { probe });
  if (json) {
    const { bytes: _bytes, ...rest } = r as any;
    io.stdout(JSON.stringify({ ...rest, byteSize: r.bytes?.byteLength }, null, 2));
    return 0;
  }
  io.stdout(`${c.bold("license:    ")} ${licenseColor(r.license)(r.license)}`);
  io.stdout(`${c.bold("confidence: ")} ${r.confidence.toFixed(2)}`);
  if (r.author) io.stdout(`${c.bold("author:     ")} ${r.author}`);
  if (r.sourcePageUrl) io.stdout(`${c.bold("source:     ")} ${r.sourcePageUrl}`);
  if (r.attributionLine) io.stdout(`${c.bold("attribution:")} ${r.attributionLine}`);
  if (r.cachedPath) {
    io.stdout(
      `${c.bold("cachedPath: ")} ${r.cachedPath} ${c.dim(`(${formatBytes(r.bytes?.byteLength)}, ${r.mime})`)}`,
    );
  }
  return 0;
}

export async function cmdProviders(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const json = getBool(args.flags, "json");
  const details = getBool(args.flags, "details");
  // Support `webfetch providers list [--details]` subcommand
  const sub = args.positional[0];
  const wantsList = !sub || sub === "list";

  if (wantsCloud(args, env)) {
    const cfg = await resolveCliConfig(args, env);
    const data = await cloudRequest<any>(cfg, "/providers", { method: "GET" });
    if (json) {
      io.stdout(JSON.stringify(data, null, 2));
      return 0;
    }
    io.stdout(JSON.stringify(data, null, 2));
    return 0;
  }

  if (!wantsList) {
    io.stderr(c.red(`unknown providers subcommand: ${sub} (expected: list)`));
    return 2;
  }

  // --details: rich tabular output sourced from the provider registry
  if (details) {
    const allMeta = providerRegistry.listMetadata();
    if (json) {
      io.stdout(JSON.stringify(allMeta, null, 2));
      return 0;
    }
    const cols = [
      { header: "ID", width: 22 },
      { header: "Name", width: 28 },
      { header: "License", width: 18 },
      { header: "Capabilities", width: 36 },
      { header: "Auth", width: 14 },
      { header: "Rate limit", width: 22 },
    ];
    const tableRows = allMeta.map((m) => {
      const authStr = m.auth?.env?.length ? m.auth.env.join(", ") : c.dim("none");
      const rlStr = m.rateLimit
        ? Object.entries(m.rateLimit)
            .filter(([k]) => k !== "note")
            .map(([k, v]) => `${v} ${k.replace(/requests/, "req/")}`)
            .join("; ") + (m.rateLimit.note ? ` (${m.rateLimit.note})` : "")
        : c.dim("-");
      const enabled = providerRegistry.isEnabled(String(m.id));
      const idStr = enabled ? String(m.id) : c.dim(`${m.id} [disabled]`);
      return [
        idStr,
        m.name,
        m.defaultLicense ?? c.dim("UNKNOWN"),
        m.capabilities.join(", "),
        authStr,
        rlStr,
      ];
    });
    io.stdout(c.bold("Provider Registry  (--details)"));
    io.stdout(renderTable(cols, tableRows));
    io.stdout("");
    io.stdout(c.dim(`${allMeta.length} providers registered. Use registry.register() to add custom providers.`));
    return 0;
  }

  // Default: existing compact table (auth + default/opt-in status)
  const rows = listProviders(env);
  if (json) {
    io.stdout(JSON.stringify(rows, null, 2));
    return 0;
  }
  const cols = [
    { header: "provider", width: 22 },
    { header: "default", width: 8 },
    { header: "opt-in", width: 7 },
    { header: "auth", width: 14 },
    { header: "env vars", width: 40 },
  ];
  const tableRows = rows.map((r) => {
    const authStatus =
      r.envVars.length === 0
        ? c.dim("none required")
        : r.authed
          ? c.green("configured")
          : c.red("missing");
    return [
      r.id,
      r.defaultOn ? c.green("yes") : c.dim("no"),
      r.optIn ? c.yellow("yes") : c.dim("no"),
      authStatus,
      r.envVars.length ? r.envVars.join(", ") : "-",
    ];
  });
  io.stdout(renderTable(cols, tableRows));
  io.stdout("");
  io.stdout(c.dim("Default-on providers run when no --providers flag is given."));
  io.stdout(c.dim("Opt-in providers (serpapi, browser, bing) run only when explicitly requested."));
  io.stdout(c.dim("Run 'webfetch providers list --details' for capability + rate-limit details."));
  return 0;
}

// ---------- `webfetch config` ---------------------------------------------

export async function cmdConfig(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const sub = args.positional[0];
  if (sub === "init") {
    const path = getString(args.flags, "path") ?? defaultConfigPath(env);
    const force = getBool(args.flags, "force");
    try {
      await writeStarterConfig(path, force);
      io.stdout(`${c.green("wrote")} ${path}`);
      return 0;
    } catch (e) {
      io.stderr(c.red((e as Error).message));
      return 2;
    }
  }
  if (sub === "show" || sub === undefined) {
    const profile = getString(args.flags, "profile");
    const cfg = await loadResolved({ profile, env });
    const json = getBool(args.flags, "json");
    if (json || sub === undefined) {
      io.stdout(JSON.stringify(cfg, null, 2));
      return 0;
    }
    io.stdout(c.bold("resolved config:"));
    for (const [k, v] of Object.entries(cfg)) {
      if (v === undefined) continue;
      // Redact the apiKey in human output; JSON mode keeps the full value for
      // scripts that explicitly asked for it.
      const printV = k === "apiKey" && typeof v === "string" && v.length > 6
        ? `${v.slice(0, 4)}\u2026${v.slice(-2)}`
        : Array.isArray(v) ? v.join(",") : String(v);
      io.stdout(`  ${c.dim(k)}: ${printV}`);
    }
    return 0;
  }
  if (sub === "get") {
    const key = args.positional[1];
    if (!key) {
      io.stderr(c.red("usage: webfetch config get <key>"));
      return 2;
    }
    const profile = getString(args.flags, "profile");
    const cfg = await loadResolved({ profile, env }) as Record<string, unknown>;
    const v = cfg[key];
    if (v === undefined) return 0;
    io.stdout(Array.isArray(v) ? v.join(",") : String(v));
    return 0;
  }
  if (sub === "set") {
    const key = args.positional[1];
    const value = args.positional[2];
    if (!key || value === undefined) {
      io.stderr(c.red("usage: webfetch config set <key> <value>"));
      return 2;
    }
    const allowed: Array<keyof ResolvedDefaults> = [
      "apiKey",
      "baseUrl",
      "license",
      "limit",
      "minWidth",
      "minHeight",
      "maxPerProvider",
      "outDir",
      "sidecar",
    ];
    if (!allowed.includes(key as keyof ResolvedDefaults)) {
      io.stderr(c.red(`unknown key: ${key} (allowed: ${allowed.join(", ")})`));
      return 2;
    }
    // Coerce numerics/bools for known numeric keys; everything else is a string.
    let coerced: string | number | boolean = value;
    if (["limit", "minWidth", "minHeight", "maxPerProvider"].includes(key)) {
      const n = Number.parseInt(value, 10);
      if (Number.isNaN(n)) {
        io.stderr(c.red(`invalid number for ${key}: ${value}`));
        return 2;
      }
      coerced = n;
    } else if (key === "sidecar") {
      coerced = value === "true" || value === "1";
    }
    const path = getString(args.flags, "path") ?? defaultConfigPath(env);
    try {
      await setConfigValue(path, key as keyof ResolvedDefaults, coerced);
    } catch (e) {
      io.stderr(c.red((e as Error).message));
      return 2;
    }
    // Echo back with apiKey redacted.
    const shown = key === "apiKey" && typeof coerced === "string" && coerced.length > 6
      ? `${coerced.slice(0, 4)}\u2026${coerced.slice(-2)}`
      : String(coerced);
    io.stdout(`${c.green("set")} ${c.dim(key)}=${shown} ${c.dim(`(${path})`)}`);
    return 0;
  }
  io.stderr(c.red("usage: webfetch config <init|show|get|set> [--profile name] [--force] [--json]"));
  return 2;
}

// ---------- `webfetch signup` ---------------------------------------------

const SIGNUP_URL = "https://app.getwebfetch.com/signup?source=cli";

/**
 * Opens the signup page in the default browser. No network call from the CLI.
 * `--dry-run` prints the URL and exits 0 without spawning anything — used by
 * the smoke test + CI to avoid opening a browser unsolicited.
 */
export async function cmdSignup(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const url = SIGNUP_URL;
  const dry = getBool(args.flags, "dry-run") || args.positional[0] === "--dry-run";
  io.stdout(`${c.bold("webfetch signup")}`);
  io.stdout(`opening ${c.dim(url)} in your default browser\u2026`);
  if (!dry) {
    const platform = process.platform;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    try {
      // Prefer Bun.spawn when available (CLI ships on Bun); fall back to
      // node:child_process for portability (tests, packaged builds).
      const bunSpawn = (globalThis as unknown as { Bun?: { spawn: (cmd: string[]) => unknown } }).Bun?.spawn;
      if (typeof bunSpawn === "function") {
        bunSpawn([cmd, url]);
      } else {
        const { spawn } = await import("node:child_process");
        spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
      }
    } catch (e) {
      io.stderr(c.yellow(`could not launch browser automatically: ${(e as Error).message}`));
      io.stderr(`open this URL manually: ${url}`);
    }
  }
  io.stdout("");
  io.stdout(c.dim("After signup, paste your API key with:"));
  io.stdout(`  ${c.bold("webfetch config set apiKey <your-key>")}`);
  return 0;
}

// ---------- `webfetch batch` ----------------------------------------------

async function* linesFromProcessStdin(): AsyncIterable<string> {
  const stream = process.stdin as NodeJS.ReadStream;
  stream.setEncoding("utf8");
  let buf = "";
  for await (const chunk of stream as any) {
    buf += chunk as string;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
  }
  if (buf.length > 0) yield buf;
}

async function* linesFromFile(path: string): AsyncIterable<string> {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(path, "utf8");
  for (const line of raw.split(/\r?\n/)) yield line;
}

export interface BatchEntry {
  query: string;
  providers?: ProviderId[];
}

export function parseBatchLine(line: string): BatchEntry | undefined {
  const s = line.trim();
  if (!s || s.startsWith("#")) return undefined;
  const tab = s.indexOf("\t");
  if (tab < 0) return { query: s };
  const query = s.slice(0, tab).trim();
  const provs = s
    .slice(tab + 1)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean) as ProviderId[];
  return { query, providers: provs.length ? provs : undefined };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
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

export async function cmdBatch(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const cfg = await resolveCliConfig(args, env);
  const { opts, limit, json } = buildSearchOptions(args, env, cfg);
  const jsonl = getBool(args.flags, "jsonl");
  const continueOnError = getBool(args.flags, "continue-on-error");
  const candidatesLimit = getInt(args.flags, "candidates") ?? limit;
  const concurrencyRaw = getInt(args.flags, "concurrency") ?? 3;
  const concurrency = Math.max(1, Math.min(8, concurrencyRaw));
  const downloadBest = getBool(args.flags, "download-best");
  const file = getString(args.flags, "file");

  const source: AsyncIterable<string> = io.readStdin
    ? io.readStdin()
    : file
      ? linesFromFile(file)
      : linesFromProcessStdin();

  const entries: BatchEntry[] = [];
  for await (const line of source) {
    const entry = parseBatchLine(line);
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) {
    io.stderr(c.red("batch: no queries read from stdin (pipe queries or pass --file)"));
    return 2;
  }

  const results = await runWithConcurrency(entries, concurrency, async (entry, index) => {
    try {
      const perOpts: SearchOptions = { ...opts, providers: entry.providers ?? opts.providers };
      const bundle = wantsCloud(args, env)
        ? await cloudRequest<SearchResultBundle>(cfg, "/search", {
            body: searchBody(entry.query, perOpts),
          })
        : await core().searchImages(entry.query, perOpts);
      const candidates = bundle.candidates.slice(0, candidatesLimit);
      const top = candidates[0];
      const downloads: Array<{ url: string; path: string; sha256: string; sidecar?: string }> = [];
      if (downloadBest && top) {
        const r = await core().downloadImage(top.url, {});
        let sidecar: string | undefined;
        if (cfg.sidecar !== false && !getBool(args.flags, "no-sidecar")) {
          sidecar = await writeSidecar(r.cachedPath, top);
        }
        downloads.push({ url: top.url, path: r.cachedPath, sha256: r.sha256, sidecar });
      }
      return {
        index,
        query: entry.query,
        status: "ok" as const,
        candidateCount: bundle.candidates.length,
        candidates,
        top: top ?? null,
        downloads,
        downloadedPath: downloads[0]?.path,
        providerReports: bundle.providerReports,
        warnings: bundle.warnings,
      };
    } catch (e) {
      if (!continueOnError) throw e;
      return {
        index,
        query: entry.query,
        status: "error" as const,
        error: (e as Error).message,
        candidateCount: 0,
        candidates: [],
        top: null,
        downloads: [],
      };
    }
  });

  if (jsonl) {
    for (const r of results) io.stdout(JSON.stringify(r));
    return results.some((r: any) => r.status === "error") ? 1 : 0;
  }

  if (json) {
    io.stdout(JSON.stringify(results, null, 2));
    return results.some((r: any) => r.status === "error") ? 1 : 0;
  }

  for (const r of results) {
    if ((r as any).status === "error") {
      io.stdout(`${c.bold(r.query)}  ${c.red("error:")} ${(r as any).error}`);
      continue;
    }
    const topPart = r.top
      ? `${c.dim("top:")} ${r.top.source} ${licenseColor(r.top.license)(shortLicense(r.top.license))} ${r.top.url}`
      : c.yellow("(no results)");
    io.stdout(
      `${c.bold(r.query)}  ${c.dim(`${r.candidateCount} candidates`)}  ${topPart}${r.downloadedPath ? c.green(`  +saved ${r.downloadedPath}`) : ""}`,
    );
  }
  io.stdout(c.dim(`\n${results.length} queries (concurrency ${concurrency}).`));
  return results.some((r: any) => r.status === "error") ? 1 : 0;
}

// ---------- `webfetch watch` ----------------------------------------------

export async function cmdWatch(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(c.red("usage: webfetch watch <query> [--interval 1h] [--once] [--webhook URL]"));
    return 2;
  }
  const cfg = await resolveCliConfig(args, env);
  const { opts } = buildSearchOptions(args, env, cfg);
  const intervalStr = getString(args.flags, "interval") ?? "1h";
  const intervalMs = parseInterval(intervalStr);
  const once = getBool(args.flags, "once");
  const webhook = getString(args.flags, "webhook");
  const json = getBool(args.flags, "json");
  const statePath = watchStatePath(query, env);

  let stopped = false;
  const onSig = () => {
    stopped = true;
    io.stderr(c.dim("\nwatch: stopping (SIGINT)"));
  };
  if (!once) process.on("SIGINT", onSig);

  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  try {
    while (!stopped) {
      const prev = await readState(statePath);
      const bundle = await core().searchImages(query, opts);
      const fresh = diffNew(prev, bundle.candidates);
      const tickAt = new Date().toISOString();

      if (json) {
        io.stdout(
          JSON.stringify(
            { at: tickAt, query, new: fresh, total: bundle.candidates.length },
            null,
            2,
          ),
        );
      } else {
        io.stdout(c.dim(`[${tickAt}] ${query}  new=${fresh.length}/${bundle.candidates.length}`));
        if (fresh.length > 0) io.stdout(renderCandidateTable(fresh));
      }

      if (webhook && fresh.length > 0) {
        try {
          await fetch(webhook, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ at: tickAt, query, new: fresh }),
          });
        } catch (e) {
          io.stderr(c.yellow(`webhook failed: ${(e as Error).message}`));
        }
      }

      await writeState(statePath, mergeState(prev, query, bundle.candidates));

      if (once) break;
      await sleep(intervalMs);
    }
  } finally {
    if (!once) process.off("SIGINT", onSig);
  }
  return 0;
}

// ---------- `webfetch cache-analytics` -------------------------------------

/**
 * Parse a human-friendly time duration string into milliseconds.
 * Accepts: Nd (days), Nh (hours), Nm (minutes), Ns (seconds).
 * Falls back to parsing as raw milliseconds if no suffix.
 */
function parseSinceFlag(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(d|h|m|s)$/.exec(s.trim());
  if (m) {
    const n = parseFloat(m[1]!);
    switch (m[2]) {
      case "d": return Math.round(n * 86_400_000);
      case "h": return Math.round(n * 3_600_000);
      case "m": return Math.round(n * 60_000);
      case "s": return Math.round(n * 1_000);
    }
  }
  const ms = Number.parseInt(s, 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 7 * 86_400_000;
}

export async function cmdCacheAnalytics(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO,
): Promise<number> {
  const sinceRaw = getString(args.flags, "since") ?? "7d";
  const windowMs = parseSinceFlag(sinceRaw);
  const json = getBool(args.flags, "json");

  const snapshot = getCacheAnalyticsSnapshot(windowMs);

  if (json) {
    io.stdout(JSON.stringify(snapshot, null, 2));
    return 0;
  }

  // Human-readable output
  const windowLabel = sinceRaw;
  io.stdout(c.bold(`Cache Analytics  (window: ${windowLabel})`));
  io.stdout(c.dim(`Generated: ${new Date(snapshot.generatedAt).toISOString()}  |  Total events in buffer: ${snapshot.totalEvents}`));
  io.stdout("");

  const hitPct = (snapshot.cacheHitRate * 100).toFixed(1);
  io.stdout(`${c.bold("Overall cache-hit rate:")}  ${hitPct}%`);
  io.stdout("");

  // Query frequency table
  const freqEntries = Object.entries(snapshot.queryFrequency).sort((a, b) => b[1] - a[1]);
  if (freqEntries.length === 0) {
    io.stdout(c.dim("No queries recorded in this window."));
    return 0;
  }

  io.stdout(c.bold("Top queries by frequency:"));
  const freqCols = [
    { header: "#", width: 3, align: "right" as const },
    { header: "count", width: 6 },
    { header: "query", width: 60 },
  ];
  const freqRows = freqEntries.slice(0, 20).map(([q, count], i) => [
    String(i + 1),
    String(count),
    q,
  ]);
  io.stdout(renderTable(freqCols, freqRows));
  io.stdout("");

  // Recommended providers
  if (snapshot.recommendedProviders.length > 0) {
    io.stdout(c.bold("Recommended providers (by cache-hit × confidence):"));
    snapshot.recommendedProviders.slice(0, 10).forEach((pid, i) => {
      io.stdout(`  ${c.dim(`${i + 1}.`)} ${pid}`);
    });
    io.stdout("");
  }

  // Per-query provider coverage (top 5 queries)
  const topQueries = snapshot.providerCoverageByQuery.slice(0, 5);
  if (topQueries.length > 0) {
    io.stdout(c.bold("Provider coverage (top queries):"));
    for (const row of topQueries) {
      io.stdout(c.dim(`  Query: "${row.query}"`));
      const cols = [
        { header: "provider", width: 22 },
        { header: "hitRate", width: 9 },
        { header: "avgConf", width: 9 },
        { header: "candidates", width: 11 },
      ];
      const rows = row.providers.map((p) => [
        p.id,
        `${(p.hitRate * 100).toFixed(1)}%`,
        p.avgConfidence.toFixed(3),
        String(p.totalCandidates),
      ]);
      io.stdout(renderTable(cols, rows));
      io.stdout("");
    }
  }

  return 0;
}

// ---------- `webfetch cache-predict` ---------------------------------------

/**
 * `webfetch cache-predict '<query>' [--top N] [--providers a,b,c] [--since 24h] [--json]`
 *
 * Show which providers are most likely to yield cache hits for a given query,
 * ranked by Bayesian posterior P(cache-hit | provider, query-class).
 *
 * Flags:
 *   --top N           Show top N providers (default: all providers).
 *   --providers a,b   Comma-separated provider ids to evaluate (default: all defaults).
 *   --since DURATION  History window for avgConfidence (default: 24h).
 *   --json            Emit raw JSON array of CacheHitPrediction.
 *   --verbose         Print extra header info.
 */
export async function cmdCachePredict(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO,
): Promise<number> {
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(c.red("usage: webfetch cache-predict '<query>' [--top N] [--providers a,b] [--since 24h] [--json]"));
    return 2;
  }

  const json = getBool(args.flags, "json");
  const verbose = getBool(args.flags, "verbose");

  const sinceRaw = getString(args.flags, "since") ?? "24h";
  const historyWindow = parseSinceFlag(sinceRaw);

  const topRaw = getInt(args.flags, "top");
  const top = topRaw ?? undefined;

  const providersFlag = getString(args.flags, "providers", "p");
  const providers: ProviderId[] = providersFlag
    ? (providersFlag.split(",").map((s) => s.trim()).filter(Boolean) as ProviderId[])
    : (DEFAULT_PROVIDERS as unknown as ProviderId[]);

  const predictions: CacheHitPrediction[] = predictCacheHits(query, providers, {
    historyWindow,
  });

  const shown = top !== undefined ? predictions.slice(0, top) : predictions;

  if (json) {
    io.stdout(JSON.stringify(shown, null, 2));
    return 0;
  }

  if (verbose) {
    io.stdout(c.bold(`Cache-Hit Predictions  (query: "${query}", window: ${sinceRaw})`));
    io.stdout(c.dim(`Evaluated ${providers.length} provider(s). Showing ${shown.length}.`));
    io.stdout("");
  }

  if (shown.length === 0) {
    io.stdout(c.yellow("No predictions available (no providers to evaluate)."));
    return 0;
  }

  const cols = [
    { header: "#",           width: 3,  align: "right" as const },
    { header: "provider",    width: 22 },
    { header: "P(hit)",      width: 8 },
    { header: "exp.hits",    width: 10 },
    { header: "avgConf",     width: 9 },
    { header: "rankScore",   width: 11 },
    { header: "data?",       width: 6 },
  ];

  const rows = shown.map((p, i) => [
    String(i + 1),
    p.provider,
    (p.pCacheHit * 100).toFixed(1) + "%",
    p.expectedCacheHits.toFixed(2),
    (p.avgConfidence * 100).toFixed(1) + "%",
    p.rankScore.toFixed(3),
    p.hasData ? "yes" : "no",
  ]);

  io.stdout(renderTable(cols, rows));
  io.stdout("");
  io.stdout(
    c.dim(
      `Providers with "data?=no" are using the Beta(1,1) prior (uniform). ` +
      `Run searches to accumulate training data.`,
    ),
  );
  return 0;
}

// ---------- `webfetch diagnose` -------------------------------------------

/**
 * Run a federated search, analyse the provider outcomes, and display a
 * structured repair report with ranked actionable steps.
 *
 * `--json`  emits the raw `FederationRepairPlan` JSON for agent consumption.
 */
export async function cmdDiagnose(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const env = io.env ?? process.env;
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(c.red("usage: webfetch diagnose <query> [flags]"));
    return 2;
  }

  const cfg = await resolveCliConfig(args, env);
  const { opts, json } = buildSearchOptions(args, env, cfg);
  const json2 = json || getBool(args.flags, "json");

  // Run the search with repair plan enabled
  const searchOpts: SearchOptions = { ...opts, repairPlan: true };
  const bundle: SearchResultBundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/search", { body: searchBody(query, searchOpts) })
    : await core().searchImages(query, searchOpts);

  // Build plan from bundle (cloud path may not return repairPlan; compute locally as fallback)
  const plan: FederationRepairPlan =
    bundle.repairPlan ??
    getFederationRepairPlan({
      reports: bundle.providerReports,
      candidates: bundle.candidates,
      licensePolicy: opts.licensePolicy ?? "safe-only",
      timeoutMs: opts.timeoutMs ?? 15_000,
      requestedProviders: opts.providers,
    });

  if (json2) {
    io.stdout(JSON.stringify(plan, null, 2));
    return 0;
  }

  // Human-readable output
  io.stdout(c.bold(`Federation Diagnostic Report`));
  io.stdout(c.dim(`Query: "${query}"  |  Generated: ${plan.generatedAt}`));
  io.stdout("");

  // Provider summary table
  const provCols = [
    { header: "provider", width: 22 },
    { header: "status", width: 14 },
    { header: "results", width: 8 },
    { header: "timeMs", width: 8 },
    { header: "detail", width: 40 },
  ];
  const provRows = bundle.providerReports.map((r) => {
    const status = r.skipped
      ? c.yellow(`skipped:${r.skipped}`)
      : r.ok
        ? c.green("ok")
        : c.red(`failed:${r.errorKind ?? "?"}`);
    const detail = r.skipped
      ? c.dim(`(${r.skipped})`)
      : r.ok
        ? c.dim(`${r.count} results`)
        : c.dim(r.error ?? "");
    return [r.provider, status, String(r.count), String(r.timeMs), detail];
  });
  io.stdout(renderTable(provCols, provRows));
  io.stdout("");

  if (plan.healthy) {
    io.stdout(c.green("✓ All providers healthy — no repair steps needed."));
    io.stdout(c.dim(`  ${bundle.candidates.length} candidate(s) returned.`));
    return 0;
  }

  // Detected patterns
  if (plan.detectedPatterns.length > 0) {
    io.stdout(c.bold("Detected patterns:"));
    for (const p of plan.detectedPatterns) {
      io.stdout(`  ${c.yellow("•")} ${p}`);
    }
    io.stdout("");
  }

  // Ranked repair steps
  io.stdout(c.bold(`Repair recommendations (${plan.recommendations.length}):`));
  plan.recommendations.forEach((rec, i) => {
    const impactPct = Math.round(rec.estimatedImpact * 100);
    io.stdout(`  ${c.bold(`${i + 1}.`)} [${c.cyan(rec.action)}]  impact ~${impactPct}%`);
    io.stdout(`     ${rec.rationale}`);

    // Render example command for common actions
    const eg = exampleCommand(query, rec.action, rec.parameters, opts);
    if (eg) {
      io.stdout(`     ${c.dim("Example:")} ${c.bold(eg)}`);
    }
    io.stdout("");
  });

  return plan.recommendations.length > 0 ? 1 : 0;
}

function exampleCommand(
  query: string,
  action: string,
  params: Record<string, unknown>,
  opts: SearchOptions,
): string | null {
  const q = `"${query}"`;
  switch (action) {
    case "retry":
      return `webfetch search ${q}`;
    case "increase-timeout": {
      const ms = params.suggestedTimeoutMs as number | undefined;
      return ms ? `webfetch search ${q} --timeout-ms ${ms}` : null;
    }
    case "relax-policy": {
      const pol = params.suggestedPolicy as string | undefined;
      return pol ? `webfetch search ${q} --license ${pol}` : null;
    }
    case "add-provider": {
      const providers = params.providers as string[] | undefined;
      if (!providers?.length) return null;
      const existing = opts.providers ?? [];
      const combined = [...new Set([...existing, ...providers])].join(",");
      return `webfetch search ${q} --providers ${combined}`;
    }
    case "enable-browser":
      return `webfetch search ${q} --providers browser`;
    case "set-auth": {
      const envVars = params.envVars as string[] | undefined;
      if (!envVars?.length) return null;
      return `${envVars.map((v) => `${v}=<key>`).join(" ")} webfetch search ${q}`;
    }
    default:
      return null;
  }
}

// ---------- pHash diagnostics helpers + command ----------------------------

/**
 * Render a histogram bar for a 0..1 fraction (width: 20 chars).
 */
function histBar(ratio: number, width = 20): string {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return `[${"█".repeat(filled)}${" ".repeat(width - filled)}]`;
}

/**
 * Emit a human-readable pHash diagnostics summary.
 * In JSON mode, serialise the raw `PhashDiagnosticsResult`.
 */
function emitPhashDiagnostics(
  diag: PhashDiagnosticsResult,
  json: boolean,
  io: CommandIO,
): void {
  if (json) {
    io.stdout(JSON.stringify(diag, null, 2));
    return;
  }

  const mixColor =
    diag.algorithmMix === "high-quality"
      ? c.green
      : diag.algorithmMix === "degraded"
        ? c.yellow
        : c.red;

  io.stdout(c.bold("pHash Diagnostics"));
  io.stdout(c.dim("─".repeat(60)));

  // Algorithm mix
  io.stdout(`${c.bold("Algorithm mix:")}  ${mixColor(diag.algorithmMix)}`);
  const dctRatio =
    diag.hashedCount > 0 ? diag.perAlgorithm.dct.count / diag.hashedCount : 0;
  const ahashRatio = 1 - dctRatio;
  io.stdout(
    `  dct-phash      ${histBar(dctRatio)}  ${diag.perAlgorithm.dct.count} candidates  (conf ${diag.perAlgorithm.dct.confidence.toFixed(2)})`,
  );
  io.stdout(
    `  ahash-fallback ${histBar(ahashRatio)}  ${diag.perAlgorithm.ahash.count} candidates  (conf ${diag.perAlgorithm.ahash.confidence.toFixed(2)})`,
  );
  io.stdout("");

  // Confidence distribution
  const cd = diag.confidenceDistribution;
  io.stdout(c.bold("Confidence distribution:"));
  io.stdout(
    `  mean ${cd.mean.toFixed(3)}  min ${cd.min.toFixed(3)}  max ${cd.max.toFixed(3)}  stdDev ${cd.stdDev.toFixed(3)}`,
  );
  io.stdout(`  ${histBar(cd.mean)} ← mean confidence`);
  io.stdout("");

  // Dedupe reliability
  const relColor =
    diag.dedupeReliability >= 0.85
      ? c.green
      : diag.dedupeReliability >= 0.5
        ? c.yellow
        : c.red;
  io.stdout(
    `${c.bold("Dedupe reliability:")} ${relColor(diag.dedupeReliability.toFixed(3))}  ${histBar(diag.dedupeReliability)}`,
  );
  if (diag.dedupeReliability < 0.5) {
    io.stdout(c.yellow("  ⚠  Low reliability — install `sharp` for DCT-pHash accuracy."));
  } else if (diag.dedupeReliability < 0.85) {
    io.stdout(c.yellow("  ⚠  Moderate reliability — some aHash fallbacks present."));
  } else {
    io.stdout(c.green("  ✓  High reliability — deduplication decisions are trustworthy."));
  }
  io.stdout("");

  // Counts
  io.stdout(c.dim(`Candidates: ${diag.totalCandidates} total, ${diag.hashedCount} hashed, ${diag.unhashedCount} unhashed`));
}

/**
 * `webfetch phash-diagnostics <query>` — run a search then analyse and print
 * pHash quality metrics without downloading anything.
 *
 * Flags:
 *   --json       Emit raw JSON diagnostics object.
 *   --verbose    Show provider reports alongside diagnostics.
 */
export async function cmdPhashDiagnostics(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO,
): Promise<number> {
  const env = io.env ?? process.env;
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(c.red("usage: webfetch phash-diagnostics <query> [flags]"));
    return 2;
  }

  const cfg = await resolveCliConfig(args, env);
  const { opts, verbose, json } = buildSearchOptions(args, env, cfg);

  const bundle: SearchResultBundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/search", { body: searchBody(query, opts) })
    : await core().searchImages(query, opts);

  if (verbose) {
    for (const w of bundle.warnings) io.stderr(c.yellow(`warning: ${w}`));
    for (const r of bundle.providerReports) {
      const detail = r.ok
        ? c.dim(`${r.count} results in ${r.timeMs}ms`)
        : c.dim(r.skipped ?? r.error ?? "failed");
      io.stderr(c.dim(`  ${r.provider}: `) + detail);
    }
    io.stderr("");
  }

  const diag = analyzePhashQuality(bundle.candidates);
  emitPhashDiagnostics(diag, json, io);
  return 0;
}

// ---------- `webfetch plugin` ---------------------------------------------

/**
 * `webfetch plugin add <git-url-or-path>`  — clone (if git URL) or load from
 *   a local path and register the plugin into the provider registry for this
 *   session. Saves the path to the config file for future bootstrap.
 *
 * `webfetch plugin list`  — show all runtime-registered plugin providers.
 *
 * `webfetch plugin test <id>`  — run a smoke-search through the plugin and
 *   print results (or errors).
 */
export async function cmdPlugin(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const sub = args.positional[0];
  const json = getBool(args.flags, "json");

  // --- `webfetch plugin list` ---
  if (!sub || sub === "list") {
    const plugins = listPluginProviders();
    if (json) {
      io.stdout(JSON.stringify(plugins, null, 2));
      return 0;
    }
    if (plugins.length === 0) {
      io.stdout(c.dim("No plugin providers registered."));
      io.stdout(c.dim("Use 'webfetch plugin add <path>' to load one."));
      return 0;
    }
    const cols = [
      { header: "ID", width: 28 },
      { header: "Display Name", width: 30 },
      { header: "License", width: 18 },
      { header: "Auth env vars", width: 30 },
    ];
    const rows = plugins.map((p) => [
      p.id,
      p.displayName,
      p.licenseDefault ?? c.dim("UNKNOWN"),
      p.authRequired?.length ? p.authRequired.join(", ") : c.dim("none"),
    ]);
    io.stdout(c.bold(`Plugin Providers (${plugins.length})`));
    io.stdout(renderTable(cols, rows));
    return 0;
  }

  // --- `webfetch plugin add <path>` ---
  if (sub === "add") {
    const target = args.positional[1];
    if (!target) {
      io.stderr(c.red("usage: webfetch plugin add <path-to-plugin>"));
      io.stderr(c.dim("  Example: webfetch plugin add ./my-plugin/index.ts"));
      return 2;
    }

    // Resolve path relative to cwd
    const pluginPath = resolve(target);

    io.stdout(c.dim(`Loading plugin from ${pluginPath} …`));

    const result = await loadPluginFromPath(pluginPath, { replace: false });

    if (!result.success) {
      io.stderr(c.red(`plugin add failed: ${result.error}`));
      return 1;
    }

    const m = result.manifest!;
    io.stdout(`${c.green("✓")} Loaded plugin ${c.bold(m.id)} (${m.name} v${m.version})`);
    if (result.warnings?.length) {
      for (const w of result.warnings) io.stderr(c.yellow(`  warning: ${w}`));
    }

    if (json) {
      io.stdout(JSON.stringify({ id: m.id, name: m.name, version: m.version, path: pluginPath }, null, 2));
    }
    return 0;
  }

  // --- `webfetch plugin test <id>` ---
  if (sub === "test") {
    const pluginId = args.positional[1];
    if (!pluginId) {
      io.stderr(c.red("usage: webfetch plugin test <plugin-id>"));
      return 2;
    }

    const provider = providerRegistry.get(pluginId);
    if (!provider) {
      io.stderr(c.red(`plugin "${pluginId}" is not registered. Load it first with 'webfetch plugin add'.`));
      return 1;
    }

    const meta = providerRegistry.getMetadata(pluginId);
    if (!json) io.stdout(c.dim(`Testing plugin "${pluginId}" …`));

    // Health-check URL if available (always to stderr so it never pollutes JSON)
    if (meta?.healthCheckUrl && !json) {
      try {
        const resp = await fetch(meta.healthCheckUrl, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          io.stdout(`${c.green("✓")} Health check passed (${resp.status}): ${meta.healthCheckUrl}`);
        } else {
          io.stdout(c.yellow(`⚠ Health check returned ${resp.status}: ${meta.healthCheckUrl}`));
        }
      } catch (e) {
        io.stdout(c.yellow(`⚠ Health check failed: ${(e as Error).message}`));
      }
    }

    // Smoke search
    const testQuery = getString(args.flags, "query", "q") ?? "test";
    const startMs = Date.now();
    try {
      const results = await provider.search(testQuery, {
        maxPerProvider: 3,
        timeoutMs: 10_000,
      });
      const elapsed = Date.now() - startMs;
      if (json) {
        io.stdout(JSON.stringify({ pluginId, query: testQuery, count: results.length, timeMs: elapsed, results }, null, 2));
        return 0;
      }
      io.stdout(`${c.green("✓")} search("${testQuery}") → ${results.length} result(s) in ${elapsed}ms`);
      for (const r of results.slice(0, 3)) {
        io.stdout(`  ${c.dim(r.license)} ${r.url}`);
      }
      if (results.length === 0) {
        io.stdout(c.yellow("  (no results — plugin may require auth or different query)"));
      }
      return 0;
    } catch (e) {
      const elapsed = Date.now() - startMs;
      if (json) {
        io.stdout(JSON.stringify({ pluginId, query: testQuery, error: (e as Error).message, timeMs: elapsed }, null, 2));
        return 1;
      }
      io.stderr(c.red(`plugin search failed (${elapsed}ms): ${(e as Error).message}`));
      return 1;
    }
  }

  io.stderr(c.red(`unknown plugin subcommand: ${sub}`));
  io.stderr(c.dim("Available: list, add, test"));
  return 2;
}

// ---------- `webfetch batch-reverse` ----------------------------------------

/**
 * `webfetch batch-reverse < urls.jsonl`
 *
 * Reads one JSON object per line from stdin (or --file). Each line must be
 * either:
 *   - A plain URL string: `"https://example.com/image.jpg"`
 *   - A JSON object with a `url` field: `{"url":"https://...","label":"optional"}`
 *
 * Fans out to `batchReverseImageSearch` across the configured providers and
 * streams one JSON result line per image to stdout.
 *
 * Flags (same search flags as `webfetch batch`):
 *   --providers      Comma-separated provider ids
 *   --license        License policy
 *   --limit          Max candidates per image (default 20)
 *   --confidence     Early-exit confidence threshold 0..1 (default 0.85)
 *   --timeout-ms     Per-image timeout ms (default 15000)
 *   --phash-threshold Hamming distance for pHash dedup (default 8)
 *   --file PATH      Read from file instead of stdin
 *   --json           Emit full batch JSON instead of streaming JSONL
 *   --verbose        Print provider summary + warnings to stderr
 */
export async function cmdBatchReverse(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO,
): Promise<number> {
  const env = io.env ?? process.env;
  const cfg = await resolveCliConfig(args, env);
  const { opts, limit, verbose, json } = buildSearchOptions(args, env, cfg);
  const file = getString(args.flags, "file");
  const confidenceRaw = getString(args.flags, "confidence");
  const confidenceThreshold =
    confidenceRaw !== undefined ? Math.max(0, Math.min(1, parseFloat(confidenceRaw))) : 0.85;
  const phashThresholdRaw = getInt(args.flags, "phash-threshold");
  const phashDedupThreshold = phashThresholdRaw ?? 8;
  const perImageTimeoutMs = getInt(args.flags, "timeout-ms") ?? opts.timeoutMs ?? 15_000;

  // Read input lines from stdin or file.
  const source: AsyncIterable<string> = io.readStdin
    ? io.readStdin()
    : file
      ? linesFromFile(file)
      : linesFromProcessStdin();

  const refs: Array<{ url: string; label?: string }> = [];
  for await (const raw of source) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      // Accept plain URL string or JSON object with `url` field.
      if (line.startsWith("{")) {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const url = String(obj.url ?? "").trim();
        if (url) refs.push({ url, label: obj.label !== undefined ? String(obj.label) : undefined });
      } else {
        // Plain URL or quoted string
        const url = line.replace(/^["']|["']$/g, "").trim();
        if (url) refs.push({ url });
      }
    } catch {
      // Skip malformed lines silently.
    }
  }

  if (refs.length === 0) {
    io.stderr(
      c.red(
        "batch-reverse: no image URLs read from stdin (pipe JSONL or pass --file).\n" +
        "  Each line: a URL string or JSON {\"url\":\"...\"}",
      ),
    );
    return 2;
  }

  if (verbose) {
    io.stderr(c.dim(`batch-reverse: processing ${refs.length} image(s)…`));
  }

  const out: BatchReverseImageOutput = await batchReverseImageSearch(
    refs.map((r) => ({ url: r.url })),
    {
      ...opts,
      providers: (opts.providers ?? []) as ProviderId[],
      limitPerImage: limit,
      confidenceThreshold,
      phashDedupThreshold,
      perImageTimeoutMs,
    },
  );

  if (json) {
    io.stdout(JSON.stringify(out, null, 2));
    if (verbose) {
      const t = out.telemetry;
      io.stderr(
        c.dim(
          `\nbatch-reverse: ${t.totalImages} image(s) | ${t.processedImages} processed` +
          ` | ${t.timedOutImages} timed out | ${t.totalWallTimeMs}ms wall time`,
        ),
      );
    }
    return 0;
  }

  // Streaming JSONL output: one result per line.
  for (const result of out.results) {
    const ref = refs[result.imageIndex];
    io.stdout(
      JSON.stringify({
        index: result.imageIndex,
        url: result.url ?? ref?.url,
        label: ref?.label,
        candidateCount: result.candidates.length,
        timedOut: result.timedOut,
        earlyExit: result.earlyExit,
        top: result.candidates[0] ?? null,
        candidates: result.candidates,
        warnings: result.warnings,
      }),
    );
  }

  if (verbose) {
    const t = out.telemetry;
    io.stderr(c.dim(`\nbatch-reverse summary:`));
    io.stderr(
      c.dim(
        `  images: ${t.totalImages} | processed: ${t.processedImages}` +
        ` | timed out: ${t.timedOutImages} | wall time: ${t.totalWallTimeMs}ms`,
      ),
    );
    if (t.providerTelemetry.length > 0) {
      io.stderr(c.dim("  provider breakdown:"));
      for (const p of t.providerTelemetry) {
        const mean = p.meanLatencyMs !== null ? `${p.meanLatencyMs.toFixed(0)}ms avg` : "n/a";
        io.stderr(
          c.dim(
            `    ${p.provider}: ${p.successes}/${p.attempts} ok, ${p.totalCandidates} cands, ${mean}`,
          ),
        );
      }
    }
    const hs = t.aggregatedScoreHistogram;
    if (hs.total > 0) {
      const highConf = hs.band80_100;
      io.stderr(
        c.dim(
          `  confidence: mean=${hs.mean?.toFixed(3) ?? "n/a"}, high-conf(≥0.8): ${highConf}/${hs.total}`,
        ),
      );
    }
  }

  return 0;
}

// ---------- `webfetch audit-license-conflicts` --------------------------------

/**
 * `webfetch audit-license-conflicts <query> [flags]`
 *
 * Runs a federated search for <query>, then audits all license conflicts found
 * across the provider results and emits structured conflict events.
 *
 * Flags:
 *   --json              Emit raw JSON BatchConflictAuditResult.
 *   --severity minor|major|critical   Filter events by minimum severity.
 *   --no-trail          Omit evidence chains from the output (faster for large pools).
 *   --verbose           Print provider reports to stderr.
 */
export async function cmdAuditLicenseConflicts(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO,
): Promise<number> {
  const env = io.env ?? process.env;
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(c.red("usage: webfetch audit-license-conflicts <query> [--json] [--severity minor|major|critical]"));
    return 2;
  }

  const cfg = await resolveCliConfig(args, env);
  const { opts, verbose, json } = buildSearchOptions(args, env, cfg);

  const severityRaw = getString(args.flags, "severity");
  const validSeverities = ["none", "minor", "major", "critical"] as const;
  type Severity = typeof validSeverities[number];
  const severityFilter: Severity | undefined =
    severityRaw && (validSeverities as readonly string[]).includes(severityRaw)
      ? (severityRaw as Severity)
      : undefined;

  const noTrail = getBool(args.flags, "no-trail");

  const bundle: SearchResultBundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/search", { body: searchBody(query, opts) })
    : await core().searchImages(query, opts);

  if (verbose) {
    for (const w of bundle.warnings) io.stderr(c.yellow(`warning: ${w}`));
    for (const r of bundle.providerReports) {
      const detail = r.ok
        ? c.dim(`${r.count} results in ${r.timeMs}ms`)
        : c.dim(r.skipped ?? r.error ?? "failed");
      io.stderr(c.dim(`  ${r.provider}: `) + detail);
    }
    io.stderr("");
  }

  // Prefer the HTTP endpoint when --cloud is set; otherwise run locally.
  let result: BatchConflictAuditResult;
  if (wantsCloud(args, env)) {
    result = await cloudRequest<BatchConflictAuditResult>(cfg, "/audit-license-conflicts", {
      body: {
        candidates: bundle.candidates,
        detailedTrail: !noTrail,
        severityFilter,
      },
    });
  } else {
    result = auditLicenseConflictBatch(bundle.candidates, {
      detailedTrail: !noTrail,
      severityFilter,
    });
  }

  if (json) {
    io.stdout(JSON.stringify(result, null, 2));
    return result.legalReviewNeeded ? 1 : 0;
  }

  // Human-readable output.
  io.stdout(c.bold(`License Conflict Audit`));
  io.stdout(c.dim(`Query: "${query}"  |  Generated: ${result.generatedAt}`));
  io.stdout(c.dim(
    `Groups: ${result.totalGroups}  |  Candidates: ${result.totalCandidates}  |  ` +
    `Critical: ${result.criticalCount}  Major: ${result.majorCount}  Minor: ${result.minorCount}`,
  ));
  io.stdout("");

  if (result.events.length === 0) {
    io.stdout(c.green("No license conflicts detected" + (severityFilter ? ` at or above "${severityFilter}"` : "") + "."));
    return 0;
  }

  for (const evt of result.events) {
    const sevColor =
      evt.conflictSeverity === "critical" ? c.red :
      evt.conflictSeverity === "major" ? c.yellow :
      evt.conflictSeverity === "minor" ? c.dim :
      c.dim;
    io.stdout(`${sevColor(`[${evt.conflictSeverity.toUpperCase()}]`)} ${evt.groupKey}`);
    io.stdout(`  consensus: ${licenseColor(evt.consensusLicense)(evt.consensusLicense)}`);
    io.stdout(`  ${c.dim(evt.auditNarrative)}`);
    if (evt.conflictingProviders.length > 0) {
      io.stdout(`  conflicting providers: ${evt.conflictingProviders.join(", ")}`);
    }
    if (evt.legalReviewRequired) {
      io.stdout(c.red("  ⚠  Legal review required before publishing."));
    }
    io.stdout("");
  }

  io.stdout(c.dim(`${result.events.length} conflict event(s) shown. Use --json for full audit trail.`));
  if (result.legalReviewNeeded) {
    io.stdout(c.red("⚠  One or more groups require legal review."));
  }
  return result.legalReviewNeeded ? 1 : 0;
}

// ---------- `webfetch resolve-license-conflicts` ------------------------------

/**
 * `webfetch resolve-license-conflicts <query> [flags]`
 *
 * Runs a federated search for <query>, then scores provider authority weights
 * and returns ranked upgrade paths for each conflict group.
 *
 * Flags:
 *   --json                    Emit raw JSON BatchConflictResolutionResult.
 *   --suggest-upgrades        (default on) Include upgrade recommendations.
 *   --min-authority N         Filter groups with authority score < N (0..1).
 *   --max-results N           Cap number of groups shown.
 *   --include-trail           Include per-provider evidence in output.
 *   --verbose                 Print provider reports to stderr.
 */
export async function cmdResolveLicenseConflicts(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO,
): Promise<number> {
  const env = io.env ?? process.env;
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(c.red("usage: webfetch resolve-license-conflicts <query> [--json] [--suggest-upgrades] [--min-authority N]"));
    return 2;
  }

  const cfg = await resolveCliConfig(args, env);
  const { opts, verbose, json } = buildSearchOptions(args, env, cfg);

  const minAuthorityRaw = getString(args.flags, "min-authority");
  const minAuthorityScore =
    minAuthorityRaw !== undefined ? Math.max(0, Math.min(1, parseFloat(minAuthorityRaw))) : undefined;
  const maxResultsRaw = getInt(args.flags, "max-results");
  const includeTrail = getBool(args.flags, "include-trail");

  const bundle: SearchResultBundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/search", { body: searchBody(query, opts) })
    : await core().searchImages(query, opts);

  if (verbose) {
    for (const w of bundle.warnings) io.stderr(c.yellow(`warning: ${w}`));
    for (const r of bundle.providerReports) {
      const detail = r.ok
        ? c.dim(`${r.count} results in ${r.timeMs}ms`)
        : c.dim(r.skipped ?? r.error ?? "failed");
      io.stderr(c.dim(`  ${r.provider}: `) + detail);
    }
    io.stderr("");
  }

  let result: BatchConflictResolutionResult;
  if (wantsCloud(args, env)) {
    result = await cloudRequest<BatchConflictResolutionResult>(cfg, "/resolve-license-conflicts", {
      body: {
        candidates: bundle.candidates,
        minAuthorityScore,
        maxResults: maxResultsRaw ?? undefined,
        includeTrail,
        suggestUpgrades: true,
      },
    });
  } else {
    result = reconcileLicenseConflictsBatch(bundle.candidates, {
      minAuthorityScore,
      maxResults: maxResultsRaw ?? undefined,
      includeTrail,
    });
  }

  if (json) {
    io.stdout(JSON.stringify(result, null, 2));
    return result.legalReviewNeeded ? 1 : 0;
  }

  // Human-readable output.
  io.stdout(c.bold(`License Conflict Resolution`));
  io.stdout(c.dim(
    `Query: "${query}"  |  Groups: ${result.totalGroups}  |  ` +
    `Candidates: ${result.totalCandidates}  |  Conflicting: ${result.conflictingGroups}`,
  ));
  io.stdout("");

  if (result.upgradePaths.length === 0) {
    io.stdout(c.green("No upgrade paths needed — all groups have consistent licenses."));
    return 0;
  }

  for (const path of result.upgradePaths) {
    const authPct = (path.authorityScore * 100).toFixed(0);
    io.stdout(
      `${c.bold(path.groupKey)}  ` +
      `${licenseColor(path.consensusLicense)(path.consensusLicense)}  ` +
      `${c.dim(`authority: ${authPct}%`)}`,
    );
    if (path.upgradeRecommendation.upgradeApplicable) {
      io.stdout(
        `  ${c.green("upgrade →")} ${path.upgradeRecommendation.recommendedLicense}  ` +
        `${c.dim(`(conf: ${(path.upgradeRecommendation.confidence * 100).toFixed(0)}%)`)}`,
      );
      io.stdout(`  ${c.dim(path.upgradeRecommendation.rationale)}`);
    } else {
      io.stdout(`  ${c.dim("no upgrade path: ")}${path.upgradeRecommendation.rationale}`);
    }
    io.stdout(`  ${c.dim(path.conflictJustification)}`);
    io.stdout("");
  }

  io.stdout(c.dim(`${result.upgradePaths.length} group(s) shown. Use --json for full details.`));
  if (result.legalReviewNeeded) {
    io.stdout(c.red("⚠  One or more groups require legal review."));
  }
  return result.legalReviewNeeded ? 1 : 0;
}

// ---------- `webfetch dedupe-report` -----------------------------------------

/**
 * `webfetch dedupe-report <query> [flags]`
 *
 * Runs a federated search for <query>, then generates a full deduplication
 * quality report: per-cluster false-positive / false-negative risk, composite
 * confidence, provider diversity, and a recommended pHash threshold.
 *
 * Flags:
 *   --phash-threshold N    Hamming distance threshold for clustering (default 8)
 *   --semantic-weight N    Weight 0..1 for metadata similarity vs pHash (default 0.3)
 *   --confidence-floor N   Min composite confidence before a cluster needs review (default 0.5)
 *   --export csv|json      Export clustering metrics in the given format (default: none)
 *   --export-path PATH     Write the export to a file instead of stdout
 *   --json                 Emit raw JSON DeduplicationReport
 *   --verbose              Print provider reports to stderr
 */
export async function cmdDedupeReport(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO,
): Promise<number> {
  const env = io.env ?? process.env;
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(c.red("usage: webfetch dedupe-report <query> [--phash-threshold N] [--export csv|json]"));
    return 2;
  }

  const cfg = await resolveCliConfig(args, env);
  const { opts, verbose, json } = buildSearchOptions(args, env, cfg);

  const phashThresholdRaw = getInt(args.flags, "phash-threshold");
  const phashThreshold = phashThresholdRaw !== undefined
    ? Math.max(1, Math.min(32, phashThresholdRaw))
    : 8;

  const semanticWeightRaw = getString(args.flags, "semantic-weight");
  const semanticWeight = semanticWeightRaw !== undefined
    ? Math.max(0, Math.min(1, parseFloat(semanticWeightRaw)))
    : 0.3;

  const confidenceFloorRaw = getString(args.flags, "confidence-floor");
  const confidenceFloor = confidenceFloorRaw !== undefined
    ? Math.max(0, Math.min(1, parseFloat(confidenceFloorRaw)))
    : 0.5;

  const exportFmt = getString(args.flags, "export") as "csv" | "json" | undefined;
  const exportPath = getString(args.flags, "export-path");

  const bundle: SearchResultBundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/search", { body: searchBody(query, opts) })
    : await core().searchImages(query, opts);

  if (verbose) {
    for (const w of bundle.warnings) io.stderr(c.yellow(`warning: ${w}`));
    for (const r of bundle.providerReports) {
      const detail = r.ok
        ? c.dim(`${r.count} results in ${r.timeMs}ms`)
        : c.dim(r.skipped ?? r.error ?? "failed");
      io.stderr(c.dim(`  ${r.provider}: `) + detail);
    }
    io.stderr("");
  }

  const report = generateDeduplicationReport(bundle.candidates, {
    phashThreshold,
    semanticWeight,
    confidenceFloor,
  });

  if (json) {
    io.stdout(JSON.stringify(report, null, 2));
    return 0;
  }

  // Human-readable output.
  io.stdout(c.bold(`Deduplication Quality Report`));
  io.stdout(
    c.dim(
      `Query: "${query}"  |  Candidates: ${report.totalCandidates}  |  ` +
      `Clusters: ${report.totalClusters}  |  dedupeRate: ${(report.dedupeRate * 100).toFixed(1)}%`,
    ),
  );
  io.stdout(c.dim(`Threshold: ${report.options.phashThreshold}  |  Recommended: ${report.recommendedThreshold}  |  Generated: ${report.generatedAt}`));
  io.stdout("");

  // Overall risk summary.
  const fpColor = report.falsePositiveRisk === "high" ? c.red : report.falsePositiveRisk === "medium" ? c.yellow : c.green;
  const fnColor = report.falseNegativeRisk === "high" ? c.red : report.falseNegativeRisk === "medium" ? c.yellow : c.green;
  io.stdout(
    `Overall risk — FP: ${fpColor(report.falsePositiveRisk)}  FN: ${fnColor(report.falseNegativeRisk)}  ` +
    `Provider diversity: ${report.providerDiversity.toFixed(2)}`,
  );
  io.stdout("");

  // Multi-candidate cluster table.
  if (report.multiCandidateClusters.length > 0) {
    io.stdout(c.bold(`Multi-candidate clusters (${report.multiCandidateClusters.length}):`));
    const cols = [
      { header: "id", width: 4 },
      { header: "size", width: 5 },
      { header: "conf", width: 6 },
      { header: "FP", width: 7 },
      { header: "FN", width: 7 },
      { header: "action", width: 8 },
      { header: "providers", width: 10 },
      { header: "centroid", width: 55 },
    ];
    const rows = report.multiCandidateClusters.map((cl) => {
      const fpC = cl.falsePositiveRisk === "high" ? c.red : cl.falsePositiveRisk === "medium" ? c.yellow : c.green;
      const fnC = cl.falseNegativeRisk === "high" ? c.red : cl.falseNegativeRisk === "medium" ? c.yellow : c.green;
      const actC = cl.recommendation === "accept" ? c.green : cl.recommendation === "review" ? c.yellow : c.red;
      return [
        cl.clusterId,
        String(cl.size),
        cl.compositeConfidence.toFixed(2),
        fpC(cl.falsePositiveRisk),
        fnC(cl.falseNegativeRisk),
        actC(cl.recommendation),
        String(cl.providerDiversity),
        cl.centroid.url.slice(0, 54),
      ];
    });
    io.stdout(renderTable(cols, rows));
    io.stdout("");
  } else {
    io.stdout(c.dim("No multi-candidate clusters found — all candidates are unique."));
    io.stdout("");
  }

  // Threshold recommendation.
  if (report.recommendedThreshold !== report.options.phashThreshold) {
    const direction = report.recommendedThreshold < report.options.phashThreshold ? "stricter" : "more permissive";
    io.stdout(
      c.yellow(
        `Threshold recommendation: change from ${report.options.phashThreshold} → ${report.recommendedThreshold} ` +
        `(${direction}) based on pairwise distance distribution.`,
      ),
    );
    io.stdout(c.dim(`  Re-run with: webfetch dedupe-report "${query}" --phash-threshold ${report.recommendedThreshold}`));
    io.stdout("");
  }

  // Export metrics if requested.
  if (exportFmt) {
    const exported = exportClusteringMetrics(report, exportFmt);
    if (exportPath) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(resolve(exportPath)), { recursive: true });
      await writeFile(resolve(exportPath), exported.content, "utf8");
      io.stdout(c.green(`Exported ${exported.rowCount} row(s) (${exported.format}) → ${resolve(exportPath)}`));
    } else {
      io.stdout(c.bold(`Metrics export (${exported.format}, ${exported.rowCount} rows):`));
      io.stdout(exported.content);
    }
  }

  return 0;
}

// ---------- `webfetch audit-phash-federation` ---------------------------------

/**
 * `webfetch audit-phash-federation <query> [flags]`
 *
 * Runs a federated search for <query>, then emits a structured report:
 *   - Total uniques by Hamming distance (threshold tuning guide)
 *   - Provider agreement matrix (which pairs agree most often)
 *   - License confidence variance per cluster
 *   - Actionable recommendations
 *
 * Flags:
 *   --json                    Emit raw JSON FederationPhashAuditReport.
 *   --hamming-threshold N     Hamming distance threshold for clustering (default 8).
 *   --anomaly-min-delta N     Min confidence delta to flag as anomaly (default 0.3).
 *   --verbose                 Print provider reports to stderr.
 */
export async function cmdAuditPhashFederation(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO,
): Promise<number> {
  const env = io.env ?? process.env;
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(c.red("usage: webfetch audit-phash-federation <query> [--hamming-threshold N] [--json]"));
    return 2;
  }

  const cfg = await resolveCliConfig(args, env);
  const { opts, verbose, json } = buildSearchOptions(args, env, cfg);

  const hammingThresholdRaw = getInt(args.flags, "hamming-threshold");
  const hammingThreshold =
    hammingThresholdRaw !== undefined ? Math.max(1, Math.min(64, hammingThresholdRaw)) : 8;

  const anomalyMinDeltaRaw = getString(args.flags, "anomaly-min-delta");
  const anomalyMinDelta =
    anomalyMinDeltaRaw !== undefined
      ? Math.max(0, Math.min(1, parseFloat(anomalyMinDeltaRaw)))
      : 0.3;

  const searchOpts: SearchOptions = {
    ...opts,
    // We need all candidates (before dedup) to detect cross-provider duplicates.
    // Disable phash dedup so we get the raw multi-provider set for analysis.
    phashDedup: false,
  };

  const bundle: SearchResultBundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/search", { body: searchBody(query, searchOpts) })
    : await core().searchImages(query, searchOpts);

  if (verbose) {
    for (const w of bundle.warnings) io.stderr(c.yellow(`warning: ${w}`));
    for (const r of bundle.providerReports) {
      const detail = r.ok
        ? c.dim(`${r.count} results in ${r.timeMs}ms`)
        : c.dim(r.skipped ?? r.error ?? "failed");
      io.stderr(c.dim(`  ${r.provider}: `) + detail);
    }
    io.stderr("");
  }

  // Build the audit report locally (always — cloud path doesn't run this yet).
  const report: FederationPhashAuditReport = buildFederationPhashAuditReport(
    query,
    bundle.candidates,
    { hammingThreshold, anomalyMinDelta },
  );

  if (json) {
    io.stdout(JSON.stringify(report, null, 2));
    return 0;
  }

  // Human-readable output
  io.stdout(c.bold(`pHash Federation Audit`));
  io.stdout(
    c.dim(
      `Query: "${query}"  |  Threshold: ${report.hammingThreshold}  |  ` +
      `Candidates: ${report.totalCandidates} (${report.hashedCandidates} hashed)  |  ` +
      `Generated: ${report.generatedAt}`,
    ),
  );
  io.stdout("");

  // 1. Threshold tuning guide
  io.stdout(c.bold("Threshold tuning guide (uniques at each Hamming distance):"));
  const ttCols = [
    { header: "threshold", width: 10 },
    { header: "uniques",   width: 8 },
    { header: "clusters",  width: 9 },
    { header: "note",      width: 30 },
  ];
  const ttRows = report.thresholdTuningGuide.map((e) => {
    const note =
      e.threshold === report.hammingThreshold
        ? c.yellow("← current")
        : e.threshold < report.hammingThreshold
          ? c.dim("stricter")
          : c.dim("more permissive");
    return [String(e.threshold), String(e.uniqueCount), String(e.clusterCount), note];
  });
  io.stdout(renderTable(ttCols, ttRows));
  io.stdout("");

  // 2. Provider agreement matrix
  if (report.providerAgreementMatrix.length > 0) {
    io.stdout(c.bold("Provider agreement matrix (pairs that most often share visuals):"));
    const paCols = [
      { header: "#",          width: 3, align: "right" as const },
      { header: "providerA",  width: 22 },
      { header: "providerB",  width: 22 },
      { header: "clusters",   width: 9 },
      { header: "agreeRate",  width: 10 },
    ];
    const paRows = report.providerAgreementMatrix.slice(0, 10).map((e, i) => [
      String(i + 1),
      e.providerA,
      e.providerB,
      String(e.sharedClusterCount),
      `${(e.agreementRate * 100).toFixed(1)}%`,
    ]);
    io.stdout(renderTable(paCols, paRows));
    io.stdout("");
  } else {
    io.stdout(c.dim("No cross-provider duplicate clusters detected."));
    io.stdout("");
  }

  // 3. Clusters with license confidence variance
  const anomalousClusters = report.clusters.filter((cl) => cl.confidenceVariance > 0.1);
  if (anomalousClusters.length > 0) {
    io.stdout(c.bold(`Clusters with license confidence variance (${anomalousClusters.length}):`));
    const clCols = [
      { header: "id",       width: 4 },
      { header: "size",     width: 5 },
      { header: "confVar",  width: 8 },
      { header: "providers", width: 40 },
    ];
    const clRows = anomalousClusters.slice(0, 10).map((cl) => [
      String(cl.clusterId),
      String(cl.clusterSize),
      cl.confidenceVariance.toFixed(3),
      [...new Set(cl.providers)].join(", "),
    ]);
    io.stdout(renderTable(clCols, clRows));
    io.stdout("");
  }

  // 4. Confidence anomaly events
  if (report.confidenceAnomalies.length > 0) {
    io.stdout(c.bold(`License confidence anomalies (${report.confidenceAnomalies.length}):`));
    for (const anomaly of report.confidenceAnomalies.slice(0, 5)) {
      const clusterId = report.clusters[anomaly.clusterIndex]?.clusterId ?? "?";
      io.stdout(
        `  ${c.yellow(`[cluster ${clusterId}]`)} delta=${anomaly.maxConfidenceDelta.toFixed(2)}  ` +
        `high: ${c.green(anomaly.highestConfidenceLicense)} → low: ${c.red(anomaly.lowestConfidenceLicense)}`,
      );
      io.stdout(
        c.dim(
          `    mean conf ${anomaly.meanConfidence.toFixed(3)}  stdDev ${anomaly.stdDevConfidence.toFixed(3)}  ` +
          `members: ${anomaly.candidateIndices.length}`,
        ),
      );
    }
    io.stdout("");
  }

  // 5. Actionable recommendations
  if (report.recommendations.length > 0) {
    io.stdout(c.bold(`Recommendations (${report.recommendations.length}):`));
    for (const rec of report.recommendations) {
      const prefix =
        rec.type === "investigate-anomaly"
          ? c.yellow("⚠")
          : rec.type === "raise-threshold" || rec.type === "lower-threshold"
            ? c.cyan("→")
            : c.dim("·");
      io.stdout(`  ${prefix} [${c.bold(rec.type)}] ${rec.message}`);
    }
    io.stdout("");
  } else {
    io.stdout(c.green("✓ No actionable issues detected."));
    io.stdout("");
  }

  // Summary footer
  io.stdout(
    c.dim(
      `Summary: ${report.totalUniques} unique visual(s), ` +
      `${report.clusterCount} duplicate cluster(s), ` +
      `${report.confidenceAnomalies.length} confidence anomaly event(s).`,
    ),
  );

  return 0;
}

/**
 * export-metadata-provenance <query>
 *
 * Runs a federated search for <query>, then builds a full metadata provenance
 * export for every result:
 *   - JSONL output with per-candidate audit trails (one line per candidate)
 *   - Consensus heatmap showing which providers agree on author/title
 *   - Conflict resolution guidance when providers disagree
 *
 * Flags:
 *   --json         Emit the full MetadataProvenanceExport JSON object instead of the
 *                  human-readable report (useful for piping into jq or saving to disk).
 *   --jsonl        Emit only the raw JSONL lines (one MetadataProvenanceRecord per line).
 *   --output PATH  Write output to a file instead of stdout.
 */
export async function cmdExportMetadataProvenance(
  args: ParsedArgs,
  io: CommandIO = DEFAULT_IO,
): Promise<number> {
  const env = io.env ?? process.env;
  const query = args.positional.join(" ").trim();
  if (!query) {
    io.stderr(
      c.red(
        "usage: webfetch export-metadata-provenance <query> [--json] [--jsonl] [--output PATH]",
      ),
    );
    return 2;
  }

  const cfg = await resolveCliConfig(args, env);
  const { opts, verbose } = buildSearchOptions(args, env, cfg);
  const json = getBool(args.flags, "json");
  const jsonl = getBool(args.flags, "jsonl");
  const outputPath = getString(args.flags, "output");

  if (verbose) {
    io.stderr(c.dim(`Running federated search for "${query}" to build provenance export…`));
  }

  const bundle = wantsCloud(args, env)
    ? await cloudRequest<SearchResultBundle>(cfg, "/search", { body: searchBody(query, opts) })
    : await core().searchImages(query, opts);
  const { candidates } = bundle;

  if (candidates.length === 0) {
    io.stderr(c.yellow(`No results for "${query}".`));
    return 0;
  }

  const exp: MetadataProvenanceExport = buildMetadataProvenanceExport(candidates);

  let output: string;
  if (jsonl) {
    output = exp.jsonlLines.join("\n");
  } else if (json) {
    output = JSON.stringify(exp, null, 2);
  } else {
    output = formatProvenanceReport(exp);
  }

  if (outputPath) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(resolve(outputPath), output, "utf8");
    io.stdout(
      c.green(
        `Provenance export written to ${resolve(outputPath)} (${exp.candidateCount} candidates)`,
      ),
    );
  } else {
    io.stdout(output);
  }

  return 0;
}

export function cmdHelp(_args: ParsedArgs, io: CommandIO = DEFAULT_IO): number {
  io.stdout(USAGE);
  return 0;
}

export function cmdVersion(_args: ParsedArgs, io: CommandIO = DEFAULT_IO): number {
  io.stdout(`webfetch ${readPackageVersion()}`);
  return 0;
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

export const USAGE = `${c.bold("webfetch")} — license-aware federated image search (CLI for webfetch-core)

${c.bold("USAGE")}
  webfetch <command> [args] [flags]

${c.bold("COMMANDS")}
  search <query>                        Federated image search
  artist <name> [--kind K]              Artist images (K: portrait|album|logo|performing)
  album <artist> <album>                Canonical album artwork
  download <url> [--out path]           Download an image (writes XMP sidecar by default)
  probe <url>                           List every <img> on a page with per-image license
  license <url> [--probe]               Determine license for an arbitrary URL
  providers [list] [--details]          List providers; --details adds capabilities, rate-limits
  batch [--file path | <stdin>]         Run many queries; one per line (query\\tproviders optional)
  batch-reverse [--file path | <stdin>] Reverse-image search many URLs; one per line (JSONL out)
  watch <query> [--interval 1h]         Poll a query; emit only new candidates per tick
  config <init|show|get|set>            Manage ~/.webfetchrc (e.g. 'config set apiKey <key>')
  signup                                Open https://app.getwebfetch.com/signup in your browser
  cache-analytics [--since 7d]          Query-replay stats, cache-hit diagnostics, provider ranking
  cache-predict '<query>' [--top N]     Providers most likely to hit cache for a query (Bayesian)
  diagnose <query>                      Run search + show ranked repair steps for provider failures
  phash-diagnostics <query>            Inspect pHash algorithm mix + dedup confidence for a query
  plugin <list|add|test>               Manage runtime provider plugins (third-party image sources)
  audit-license-conflicts <query>      Audit all license conflicts from a federation run [--json] [--severity major]
  resolve-license-conflicts <query>    Recommend license upgrades per provider [--json] [--suggest-upgrades]
  dedupe-report <query>                Cluster dedup quality report: FP/FN risk, confidence, threshold recommendation
  audit-phash-federation <query>       Federation-wide pHash duplicate audit: clusters, anomalies, provider agreement
  warm [--input queries.jsonl]         Cache warm-up daemon: pre-populate cache + track hit rates
  help                                  Show this message
  version                               Print version

${c.bold("COMMON SEARCH FLAGS")}
  --providers a,b       Comma-separated provider ids (default: safe set; see 'webfetch providers')
  --license MODE        open | safe (default) | context | prefer | any
  --max-per-provider N  Cap results per provider
  --min-width W         Minimum pixel width
  --min-height H        Minimum pixel height
  --limit N             Max rows to print (default 20)
  --json                Emit raw JSON array of ImageCandidate
  --cloud               Use hosted API via WEBFETCH_API_KEY and WEBFETCH_BASE_URL
  --verbose             Print provider reports + warnings to stderr
  --profile NAME        Activate a profile from ~/.webfetchrc
  --pick                Interactive picker (TTY only); choose a candidate to download
  --no-sidecar          Skip writing the .xmp attribution sidecar on download
  --phash-diagnostics   After results, print pHash algorithm mix + dedup confidence summary
  --semantic-dedupe     Cluster results by pHash distance; emit one representative per unique image
  --no-phash-dedup      Disable multi-provider pHash similarity dedup (default: enabled; also WEBFETCH_PHASH_DEDUP=0)

${c.bold("EXAMPLES")}
  webfetch search "drake portrait" --json --limit 5
  webfetch search "drake" --pick
  webfetch artist "Taylor Swift" --kind portrait --min-width 1200 --profile musicians
  echo -e "drake portrait\\nradiohead album" | webfetch batch --concurrency 2 --jsonl --continue-on-error
  webfetch watch "weekly artist photos" --interval 6h --webhook https://hooks.example
  webfetch config init
  webfetch config show --profile editorial

${c.bold("ENV")}
  UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, PIXABAY_API_KEY, BRAVE_API_KEY,
  BING_API_KEY, SERPAPI_KEY, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
  WEBFETCH_USER_AGENT, WEBFETCH_BLOCKLIST, WEBFETCH_CONFIG,
  WEBFETCH_PROVIDERS, WEBFETCH_LICENSE, WEBFETCH_LIMIT, WEBFETCH_MIN_WIDTH
`;

export type Dispatcher = (args: ParsedArgs, io?: CommandIO) => Promise<number> | number;

export const COMMANDS: Record<string, Dispatcher> = {
  search: cmdSearch,
  artist: cmdArtist,
  album: cmdAlbum,
  download: cmdDownload,
  probe: cmdProbe,
  license: cmdLicense,
  providers: cmdProviders,
  batch: cmdBatch,
  "batch-reverse": cmdBatchReverse,
  watch: cmdWatch,
  config: cmdConfig,
  signup: cmdSignup,
  "cache-analytics": cmdCacheAnalytics,
  "cache-predict": cmdCachePredict,
  diagnose: cmdDiagnose,
  "phash-diagnostics": cmdPhashDiagnostics,
  plugin: cmdPlugin,
  "audit-license-conflicts": cmdAuditLicenseConflicts,
  "resolve-license-conflicts": cmdResolveLicenseConflicts,
  "dedupe-report": cmdDedupeReport,
  "audit-phash-federation": cmdAuditPhashFederation,
  "export-metadata-provenance": cmdExportMetadataProvenance,
  warm: cmdWarm,
  help: cmdHelp,
  "--help": cmdHelp,
  "-h": cmdHelp,
  version: cmdVersion,
  "--version": cmdVersion,
  "-v": cmdVersion,
};

export async function run(argv: string[], io: CommandIO = DEFAULT_IO): Promise<number> {
  if (argv.length === 0) {
    io.stdout(USAGE);
    return 0;
  }
  const [cmd, ...rest] = argv;
  const handler = COMMANDS[cmd!];
  if (!handler) {
    io.stderr(c.red(`unknown command: ${cmd}`));
    io.stderr(`run '${c.bold("webfetch help")}' for usage.`);
    return 2;
  }
  const parsed = parseArgs(rest);
  return await handler(parsed, io);
}

export { parseArgs };
