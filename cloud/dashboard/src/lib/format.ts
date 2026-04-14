/** Format helpers used across the dashboard. Kept dependency-free. */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toFixed(4)}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export function formatPct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "0%";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatRelative(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "never";
  const diff = Date.now() - ms;
  if (diff < 0) return "in the future";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function maskKey(prefix: string): string {
  return `${prefix}${"•".repeat(24)}`;
}

export function toCsv(
  rows: ReadonlyArray<Record<string, string | number | null | undefined>>,
): string {
  if (rows.length === 0) return "";
  const headers = Array.from(
    rows.reduce((set, row) => {
      for (const k of Object.keys(row)) set.add(k);
      return set;
    }, new Set<string>()),
  );
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out: string[] = [headers.join(",")];
  for (const row of rows) out.push(headers.map((h) => esc(row[h])).join(","));
  return out.join("\n");
}
