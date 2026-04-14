/**
 * Interactive TTY picker. After a search returns candidates we print a
 * numbered table and read a single keystroke via stdin raw mode.
 *
 * `readKey` is injectable so tests can simulate keystrokes without a TTY.
 */

import type { ImageCandidate } from "@webfetch/core";
import { c, licenseColor, renderTable } from "./format.ts";

export type KeyReader = () => Promise<string>;

export interface PickerIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readKey?: KeyReader;
  isTTY?: boolean;
}

export type PickerChoice =
  | { kind: "pick"; index: number }
  | { kind: "download-all" }
  | { kind: "quit" };

function shortLic(lic: string): string {
  return lic.replace("PUBLIC_DOMAIN", "PD").replace("EDITORIAL_LICENSED", "EDITORIAL").replace("PRESS_KIT_ALLOWLIST", "PRESSKIT");
}

export function renderCandidateTable(cands: ImageCandidate[]): string {
  const cols = [
    { header: "#", width: 3, align: "right" as const },
    { header: "source", width: 14 },
    { header: "license", width: 10 },
    { header: "dims", width: 11 },
    { header: "url", width: 48 },
    { header: "title", width: 32 },
  ];
  const rows = cands.map((cand, i) => {
    const dims = cand.width && cand.height ? `${cand.width}x${cand.height}` : "?";
    const licColor = licenseColor(cand.license);
    return [
      String(i + 1),
      cand.source,
      licColor(shortLic(cand.license)),
      dims,
      cand.url,
      cand.title ?? cand.author ?? "",
    ];
  });
  return renderTable(cols, rows);
}

/** Default TTY keystroke reader using Bun/Node raw mode. */
export function defaultReadKey(): Promise<string> {
  return new Promise((resolveP) => {
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (v: boolean) => void };
    const prev = stdin.isRaw;
    if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
    stdin.resume();
    const onData = (buf: Buffer) => {
      stdin.off("data", onData);
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(!!prev);
      stdin.pause();
      resolveP(buf.toString("utf8"));
    };
    stdin.on("data", onData);
  });
}

/** Read keystrokes until a valid choice. `Ctrl-C` (\x03) and `q` quit. */
export async function promptChoice(n: number, io: PickerIO): Promise<PickerChoice> {
  const read = io.readKey ?? defaultReadKey;
  while (true) {
    io.stdout(c.dim(`[1-${n}] pick / [d] download all / [q] quit`));
    const key = (await read()).trim().toLowerCase();
    if (key === "q" || key === "\x03" || key === "\x1b") return { kind: "quit" };
    if (key === "d") return { kind: "download-all" };
    // Multi-digit number: take up-to-n chars, parse int.
    const num = Number.parseInt(key, 10);
    if (Number.isFinite(num) && num >= 1 && num <= n) {
      return { kind: "pick", index: num - 1 };
    }
    io.stderr(c.yellow(`invalid selection: ${JSON.stringify(key)}`));
  }
}
