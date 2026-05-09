import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

type Candidate = {
  url: string;
  attributionLine?: string;
  [key: string]: unknown;
};

type DownloadInfo = {
  path?: string;
  sha256?: string;
  mime?: string;
  bytes?: number;
  byteSize?: number;
  cachedPath?: string;
  sidecar?: string;
};

type Options = {
  query: string;
  outDir: string;
  license: string;
  providers?: string;
  maxPerProvider: string;
  limit: string;
  minWidth: string;
  minHeight: string;
  webfetchBin: string;
};

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    values.set(key, value);
    i += 1;
  }

  const required = (key: string) => {
    const value = values.get(key);
    if (!value) {
      throw new Error(`Missing required --${key}`);
    }
    return value;
  };

  return {
    query: required("query"),
    outDir: required("out-dir"),
    license: values.get("license") || "safe-only",
    providers: values.get("providers") || undefined,
    maxPerProvider: values.get("max-per-provider") || "3",
    limit: values.get("limit") || "10",
    minWidth: values.get("min-width") || "0",
    minHeight: values.get("min-height") || "0",
    webfetchBin: required("webfetch-bin"),
  };
}

function extensionFor(url: string): string {
  try {
    const ext = extname(new URL(url).pathname);
    return (ext || ".jpg").slice(0, 5);
  } catch {
    const ext = extname(basename(url));
    return (ext || ".jpg").slice(0, 5);
  }
}

function runBun(bin: string, args: string[]) {
  const result = spawnSync("bun", [bin, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `bun ${bin} ${args.join(" ")} failed`);
  }
  return result.stdout;
}

export function runWebfetchAction(options: Options) {
  mkdirSync(options.outDir, { recursive: true });

  const searchArgs = [
    "search",
    options.query,
    "--json",
    "--license",
    options.license,
    "--max-per-provider",
    options.maxPerProvider,
    "--limit",
    options.limit,
  ];
  if (options.providers) {
    searchArgs.push("--providers", options.providers);
  }
  if (options.minWidth !== "0") {
    searchArgs.push("--min-width", options.minWidth);
  }
  if (options.minHeight !== "0") {
    searchArgs.push("--min-height", options.minHeight);
  }

  const rawResults = runBun(options.webfetchBin, searchArgs);
  const searchPath = join(options.outDir, "_search.json");
  writeFileSync(searchPath, rawResults);

  const candidates = JSON.parse(rawResults) as Candidate[];
  if (!Array.isArray(candidates)) {
    throw new Error("webfetch search did not return a JSON array");
  }

  const manifest = [];
  let index = 0;
  for (const candidate of candidates) {
    index += 1;
    const base = String(index).padStart(3, "0");
    const file = join(options.outDir, `${base}${extensionFor(candidate.url)}`);
    const download = spawnSync(
      "bun",
      [options.webfetchBin, "download", candidate.url, "--out", file, "--json"],
      { encoding: "utf8" },
    );

    if (download.status !== 0) {
      console.error("download failed", candidate.url, download.stderr);
      continue;
    }

    const info = JSON.parse(download.stdout) as DownloadInfo;
    const sidecar = info.sidecar || `${file}.xmp`;
    const attributionPath = `${file}.attribution.txt`;
    writeFileSync(attributionPath, `${candidate.attributionLine || ""}\n`);
    manifest.push({
      file,
      path: info.path || file,
      sha256: info.sha256,
      mime: info.mime,
      byteSize: info.byteSize ?? info.bytes,
      cachedPath: info.cachedPath,
      sidecar,
      attributionPath,
      candidate,
    });
  }

  const manifestPath = join(options.outDir, "_manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifestPath, count: manifest.length, searchPath };
}

function writeGithubOutputs(outputs: { manifestPath: string; count: number }) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }
  const line = `manifest=${outputs.manifestPath}\ncount=${outputs.count}\n`;
  writeFileSync(process.env.GITHUB_OUTPUT, line, { flag: "a" });
}

if (import.meta.main) {
  try {
    writeGithubOutputs(runWebfetchAction(parseArgs(Bun.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
