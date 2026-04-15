#!/usr/bin/env bun
/**
 * @webfetch/cli entrypoint.
 *
 * Keep this file thin: argv parsing + dispatch lives in commands.ts so tests
 * can exercise the surface without spawning a subprocess.
 */

import { run } from "./commands.ts";
import { c } from "./format.ts";

const argv = process.argv.slice(2);

run(argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    const msg = (err as Error)?.message ?? String(err);
    process.stderr.write(`${c.red("error:")} ${msg}\n`);
    if (process.env.WEBFETCH_DEBUG) {
      process.stderr.write(`${String((err as Error)?.stack ?? "")}\n`);
    }
    process.exit(1);
  });
