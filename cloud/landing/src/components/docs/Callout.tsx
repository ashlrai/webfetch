import type { ReactNode } from "react";

type Kind = "info" | "warn" | "danger" | "tip";
const STYLES: Record<Kind, { bar: string; label: string; badge: string }> = {
  info: { bar: "#5b8cff", label: "Note", badge: "INFO" },
  warn: { bar: "#fbbf24", label: "Heads up", badge: "WARN" },
  danger: { bar: "#f87171", label: "Caution", badge: "DANGER" },
  tip: { bar: "#4ade80", label: "Tip", badge: "TIP" },
};

export function Callout({
  kind = "info",
  title,
  children,
}: { kind?: Kind; title?: string; children: ReactNode }) {
  const s = STYLES[kind];
  return (
    <aside
      role="note"
      className="my-6 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elev)] overflow-hidden"
    >
      <div
        className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] font-mono text-[11px]"
        style={{ borderLeft: `3px solid ${s.bar}` }}
      >
        <span className="font-semibold" style={{ color: s.bar }}>
          {s.badge}
        </span>
        <span className="text-[var(--color-fg-muted)]">{title ?? s.label}</span>
      </div>
      <div className="px-4 py-3 text-sm text-[var(--color-fg-muted)] leading-relaxed">
        {children}
      </div>
    </aside>
  );
}
