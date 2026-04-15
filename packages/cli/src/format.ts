/**
 * Tiny ANSI + table helpers. No chalk dep.
 */

const useColor =
  !process.env.NO_COLOR && (process.env.FORCE_COLOR === "1" || process.stdout.isTTY === true);

function wrap(code: number, s: string): string {
  if (!useColor) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

export const c = {
  bold: (s: string) => wrap(1, s),
  dim: (s: string) => wrap(2, s),
  red: (s: string) => wrap(31, s),
  green: (s: string) => wrap(32, s),
  yellow: (s: string) => wrap(33, s),
  blue: (s: string) => wrap(34, s),
  magenta: (s: string) => wrap(35, s),
  cyan: (s: string) => wrap(36, s),
  gray: (s: string) => wrap(90, s),
};

export function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  if (width <= 1) return s.slice(0, width);
  return `${s.slice(0, width - 1)}\u2026`;
}

export interface TableColumn {
  header: string;
  width: number;
  align?: "left" | "right";
  color?: (s: string) => string;
}

export function renderTable(cols: TableColumn[], rows: string[][]): string {
  const lines: string[] = [];
  const headerCells = cols.map((col) => pad(col.header, col.width, col.align ?? "left"));
  lines.push(c.bold(headerCells.join("  ")));
  lines.push(c.gray(cols.map((col) => "-".repeat(col.width)).join("  ")));
  for (const row of rows) {
    const cells = cols.map((col, i) => {
      const raw = row[i] ?? "";
      const truncd = truncate(raw, col.width);
      const padded = pad(truncd, col.width, col.align ?? "left");
      return col.color ? col.color(padded) : padded;
    });
    lines.push(cells.join("  "));
  }
  return lines.join("\n");
}

function pad(s: string, width: number, align: "left" | "right"): string {
  if (s.length >= width) return s;
  const gap = " ".repeat(width - s.length);
  return align === "right" ? gap + s : s + gap;
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "?";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

export function licenseColor(lic: string): (s: string) => string {
  switch (lic) {
    case "CC0":
    case "PUBLIC_DOMAIN":
      return c.green;
    case "CC_BY":
    case "CC_BY_SA":
      return c.cyan;
    case "EDITORIAL_LICENSED":
    case "PRESS_KIT_ALLOWLIST":
      return c.yellow;
    case "UNKNOWN":
      return c.red;
    default:
      return (s) => s;
  }
}
