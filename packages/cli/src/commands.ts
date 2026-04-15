/**
 * Subcommand implementations. Exported so `tests/cli.test.ts` can dispatch
 * them directly and assert structured output without shelling out.
 *
 * Convention: every command resolves to a numeric exit code. "No results"
 * is exit 0 with a friendly message. Usage errors are exit 2. Unexpected
 * failures (thrown) bubble up to the top-level catch in index.ts.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { ImageCandidate, ProviderId, SearchOptions, SearchResultBundle } from "@webfetch/core";
import { type ParsedArgs, getBool, getInt, getString, parseArgs } from "./args.ts";
import {
  BUILTIN_DEFAULTS,
  DEFAULT_BASE_URL,
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

  return {
    opts: {
      providers,
      licensePolicy,
      maxPerProvider,
      minWidth,
      minHeight,
      timeoutMs: getInt(args.flags, "timeout-ms"),
      auth: authFromEnv(env),
    },
    limit,
    verbose: getBool(args.flags, "verbose"),
    json: getBool(args.flags, "json"),
    providers,
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
  if (wantsSidecar) sidecar = await writeSidecar(finalPath, cand);
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
  const bundle = await core().searchImages(query, opts);
  if (shouldPick(args, io)) return maybePick(bundle, args, env, cfg, io, limit);
  return emitBundle(bundle, { json, limit, verbose }, io);
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
  const bundle = await core().searchArtistImages(name, kind, opts);
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
  const bundle = await core().searchAlbumCover(artist, album, opts);
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
    const cand: Partial<ImageCandidate> = {
      url,
      license: (r as any).license ?? "UNKNOWN",
      author: (r as any).author,
      attributionLine: (r as any).attributionLine,
      sourcePageUrl: (r as any).sourcePageUrl,
      licenseUrl: (r as any).licenseUrl,
      title: (r as any).title,
    };
    sidecarPath = await writeSidecar(finalPath, cand);
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
  const url = args.positional[0];
  if (!url) {
    io.stderr(c.red("usage: webfetch probe <url> [--json]"));
    return 2;
  }
  const json = getBool(args.flags, "json");
  const r = await core().probePage(url);
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
    .replace("EDITORIAL_LICENSED", "EDITORIAL")
    .replace("PRESS_KIT_ALLOWLIST", "PRESSKIT");
}

export async function cmdLicense(args: ParsedArgs, io: CommandIO = DEFAULT_IO): Promise<number> {
  const url = args.positional[0];
  if (!url) {
    io.stderr(c.red("usage: webfetch license <url> [--probe] [--json]"));
    return 2;
  }
  const probe = getBool(args.flags, "probe");
  const json = getBool(args.flags, "json");
  const r = await core().fetchWithLicense(url, { probe });
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
  const rows = listProviders(env);
  if (json) {
    io.stdout(JSON.stringify(rows, null, 2));
    return 0;
  }
  const cols = [
    { header: "provider", width: 16 },
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

  const results = await runWithConcurrency(entries, concurrency, async (entry) => {
    const perOpts: SearchOptions = { ...opts, providers: entry.providers ?? opts.providers };
    const bundle = await core().searchImages(entry.query, perOpts);
    const top = bundle.candidates[0];
    let downloadedPath: string | undefined;
    if (downloadBest && top) {
      const r = await core().downloadImage(top.url, {});
      downloadedPath = r.cachedPath;
      if (cfg.sidecar !== false && !getBool(args.flags, "no-sidecar")) {
        await writeSidecar(r.cachedPath, top);
      }
    }
    return {
      query: entry.query,
      candidateCount: bundle.candidates.length,
      top: top ?? null,
      downloadedPath,
    };
  });

  if (json) {
    io.stdout(JSON.stringify(results, null, 2));
    return 0;
  }

  for (const r of results) {
    const topPart = r.top
      ? `${c.dim("top:")} ${r.top.source} ${licenseColor(r.top.license)(shortLicense(r.top.license))} ${r.top.url}`
      : c.yellow("(no results)");
    io.stdout(
      `${c.bold(r.query)}  ${c.dim(`${r.candidateCount} candidates`)}  ${topPart}${r.downloadedPath ? c.green(`  +saved ${r.downloadedPath}`) : ""}`,
    );
  }
  io.stdout(c.dim(`\n${results.length} queries (concurrency ${concurrency}).`));
  void limit;
  return 0;
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

export function cmdHelp(_args: ParsedArgs, io: CommandIO = DEFAULT_IO): number {
  io.stdout(USAGE);
  return 0;
}

export function cmdVersion(_args: ParsedArgs, io: CommandIO = DEFAULT_IO): number {
  io.stdout("webfetch 0.1.0");
  return 0;
}

export const USAGE = `${c.bold("webfetch")} — license-aware federated image search (CLI for @webfetch/core)

${c.bold("USAGE")}
  webfetch <command> [args] [flags]

${c.bold("COMMANDS")}
  search <query>                        Federated image search
  artist <name> [--kind K]              Artist images (K: portrait|album|logo|performing)
  album <artist> <album>                Canonical album artwork
  download <url> [--out path]           Download an image (writes XMP sidecar by default)
  probe <url>                           List every <img> on a page with per-image license
  license <url> [--probe]               Determine license for an arbitrary URL
  providers                             List configured providers + auth status
  batch [--file path | <stdin>]         Run many queries; one per line (query\\tproviders optional)
  watch <query> [--interval 1h]         Poll a query; emit only new candidates per tick
  config <init|show|get|set>            Manage ~/.webfetchrc (e.g. 'config set apiKey <key>')
  signup                                Open https://app.getwebfetch.com/signup in your browser
  help                                  Show this message
  version                               Print version

${c.bold("COMMON SEARCH FLAGS")}
  --providers a,b       Comma-separated provider ids (default: safe set; see 'webfetch providers')
  --license MODE        safe (default) | prefer | any
  --max-per-provider N  Cap results per provider
  --min-width W         Minimum pixel width
  --min-height H        Minimum pixel height
  --limit N             Max rows to print (default 20)
  --json                Emit raw JSON array of ImageCandidate
  --verbose             Print provider reports + warnings to stderr
  --profile NAME        Activate a profile from ~/.webfetchrc
  --pick                Interactive picker (TTY only); choose a candidate to download
  --no-sidecar          Skip writing the .xmp attribution sidecar on download

${c.bold("EXAMPLES")}
  webfetch search "drake portrait" --json --limit 5
  webfetch search "drake" --pick
  webfetch artist "Taylor Swift" --kind portrait --min-width 1200 --profile musicians
  echo -e "drake portrait\\nradiohead album" | webfetch batch --concurrency 2 --json
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
  watch: cmdWatch,
  config: cmdConfig,
  signup: cmdSignup,
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
