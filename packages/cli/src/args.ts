/**
 * Tiny argv parser. Handles:
 *   - positional args
 *   - --long value   --long=value   --long (boolean)
 *   - -s value       -s=value       -s (boolean)
 *   - `--` end-of-flags sentinel
 *
 * Intentionally dumb: no schema, no coercion. Callers coerce per-command.
 */

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** Flags that should never consume the next token even if present. */
const BOOLEAN_FLAGS = new Set([
  "json",
  "probe",
  "verbose",
  "help",
  "h",
  "version",
  "v",
  "pick",
  "once",
  "force",
  "no-sidecar",
  "download-best",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  let endOfFlags = false;

  while (i < argv.length) {
    const tok = argv[i]!;
    if (endOfFlags) {
      positional.push(tok);
      i++;
      continue;
    }
    if (tok === "--") {
      endOfFlags = true;
      i++;
      continue;
    }
    if (tok.startsWith("--")) {
      const body = tok.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        i++;
        continue;
      }
      const name = body;
      if (BOOLEAN_FLAGS.has(name) || i + 1 >= argv.length || argv[i + 1]!.startsWith("-")) {
        flags[name] = true;
        i++;
      } else {
        flags[name] = argv[i + 1]!;
        i += 2;
      }
      continue;
    }
    if (tok.startsWith("-") && tok.length > 1) {
      const body = tok.slice(1);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        i++;
        continue;
      }
      const name = body;
      if (BOOLEAN_FLAGS.has(name) || i + 1 >= argv.length || argv[i + 1]!.startsWith("-")) {
        flags[name] = true;
        i++;
      } else {
        flags[name] = argv[i + 1]!;
        i += 2;
      }
      continue;
    }
    positional.push(tok);
    i++;
  }

  return { positional, flags };
}

export function getString(flags: Record<string, string | boolean>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = flags[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

export function getBool(flags: Record<string, string | boolean>, ...keys: string[]): boolean {
  for (const k of keys) if (flags[k] === true) return true;
  return false;
}

export function getInt(flags: Record<string, string | boolean>, ...keys: string[]): number | undefined {
  const s = getString(flags, ...keys);
  if (s === undefined) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}
