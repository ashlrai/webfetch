/**
 * Pure-SVG bar chart. No chart lib — we want zero runtime dependency and
 * consistent dark-mode rendering.
 */

export interface BarPoint {
  label: string;
  value: number;
  /** optional secondary value shown on hover */
  sub?: string;
}

export default function UsageChart({
  data,
  height = 140,
  accent = "var(--accent)",
  emptyLabel = "No data in this window yet.",
}: {
  data: ReadonlyArray<BarPoint>;
  height?: number;
  accent?: string;
  emptyLabel?: string;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div
        className="card p-10 text-center text-sm"
        style={{ color: "var(--text-dim)" }}
      >
        {emptyLabel}
      </div>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 2;
  const barWidth = `calc((100% - ${(data.length - 1) * gap}px) / ${data.length})`;

  return (
    <div
      className="card p-4"
      style={{ background: "var(--bg-card)" }}
      role="img"
      aria-label="Usage over time"
    >
      <div
        className="flex items-end"
        style={{ height, gap: `${gap}px` }}
      >
        {data.map((d, i) => {
          const h = (d.value / max) * 100;
          return (
            <div
              key={`${d.label}-${i}`}
              title={`${d.label}: ${d.value.toLocaleString()}${d.sub ? ` · ${d.sub}` : ""}`}
              style={{
                width: barWidth,
                height: `${Math.max(2, h)}%`,
                background: `linear-gradient(180deg, ${accent}, rgba(255,90,31,0.25))`,
                borderRadius: "4px 4px 0 0",
                transition: "opacity 120ms ease",
              }}
            />
          );
        })}
      </div>
      <div
        className="mt-3 flex items-center justify-between text-[10px] mono"
        style={{ color: "var(--text-mute)" }}
      >
        <span>{data[0]?.label}</span>
        <span>peak {max.toLocaleString()}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
