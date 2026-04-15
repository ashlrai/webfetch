/**
 * Inline-SVG time-series chart. Renders both a filled area and value bars
 * with gridlines + axis ticks. Pure, no deps.
 */

export interface ChartPoint {
  label: string;
  value: number;
  sub?: string;
}

export function AreaChart({
  data,
  height = 200,
  accent = "var(--accent)",
  fill = "rgba(255,90,31,0.12)",
  format = (v: number) => v.toLocaleString(),
  emptyLabel = "No data in this window.",
}: {
  data: ReadonlyArray<ChartPoint>;
  height?: number;
  accent?: string;
  fill?: string;
  format?: (v: number) => string;
  emptyLabel?: string;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="surface empty">
        <div className="empty-sub">{emptyLabel}</div>
      </div>
    );
  }

  const W = 1000;
  const H = height;
  const pad = { t: 16, r: 8, b: 22, l: 36 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const max = Math.max(1, ...data.map((d) => d.value));
  const step = innerW / Math.max(1, data.length - 1);

  const pts = data.map((d, i) => {
    const x = pad.l + i * step;
    const y = pad.t + innerH - (d.value / max) * innerH;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pad.l + innerW},${pad.t + innerH} L${pad.l},${pad.t + innerH} Z`;

  // 4 horizontal gridlines
  const grids = [0, 0.25, 0.5, 0.75, 1];
  const tickEvery = Math.max(1, Math.floor(data.length / 6));

  return (
    <div className="surface p-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height }} role="img" aria-label="Usage over time">
        {grids.map((g) => {
          const y = pad.t + innerH - g * innerH;
          return (
            <g key={g}>
              <line className="chart-grid" x1={pad.l} x2={pad.l + innerW} y1={y} y2={y} />
              <text className="chart-tick" x={pad.l - 6} y={y + 3} textAnchor="end">
                {format(Math.round(g * max))}
              </text>
            </g>
          );
        })}
        <path d={area} fill={fill} />
        <path d={line} stroke={accent} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2} fill={accent} opacity={i === pts.length - 1 ? 1 : 0} />
        ))}
        {data.map((d, i) => {
          if (i % tickEvery !== 0 && i !== data.length - 1) return null;
          const x = pad.l + i * step;
          return (
            <text key={i} className="chart-tick" x={x} y={H - 4} textAnchor="middle">
              {d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function BarChart({
  data,
  height = 180,
  accent = "var(--accent)",
  emptyLabel = "No data yet.",
  format = (v: number) => v.toLocaleString(),
}: {
  data: ReadonlyArray<ChartPoint>;
  height?: number;
  accent?: string;
  emptyLabel?: string;
  format?: (v: number) => string;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="surface empty">
        <div className="empty-sub">{emptyLabel}</div>
      </div>
    );
  }
  const W = 1000;
  const H = height;
  const pad = { t: 12, r: 8, b: 22, l: 36 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const slot = innerW / n;
  const barW = Math.max(2, Math.min(16, slot * 0.68));
  const grids = [0, 0.5, 1];
  const tickEvery = Math.max(1, Math.floor(n / 8));

  return (
    <div className="surface p-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height }} role="img" aria-label="Bar chart">
        {grids.map((g) => {
          const y = pad.t + innerH - g * innerH;
          return (
            <g key={g}>
              <line className="chart-grid" x1={pad.l} x2={pad.l + innerW} y1={y} y2={y} />
              <text className="chart-tick" x={pad.l - 6} y={y + 3} textAnchor="end">{format(Math.round(g * max))}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = pad.l + i * slot + (slot - barW) / 2;
          const y = pad.t + innerH - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={Math.max(1, h)} rx={1.5} fill={accent} opacity={0.85}>
                <title>{`${d.label}: ${format(d.value)}${d.sub ? ` · ${d.sub}` : ""}`}</title>
              </rect>
            </g>
          );
        })}
        {data.map((d, i) => {
          if (i % tickEvery !== 0 && i !== data.length - 1) return null;
          const x = pad.l + i * slot + slot / 2;
          return (
            <text key={i} className="chart-tick" x={x} y={H - 4} textAnchor="middle">
              {d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function HBarList({
  data,
  format = (v: number) => v.toLocaleString(),
  accent = "var(--accent)",
  limit = 8,
}: {
  data: ReadonlyArray<{ label: string; value: number }>;
  format?: (v: number) => string;
  accent?: string;
  limit?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  const rows = data.slice(0, limit);
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((d) => {
        const pct = (d.value / max) * 100;
        return (
          <li key={d.label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="mono truncate">{d.label}</span>
              <span className="mono tnum" style={{ color: "var(--text-dim)" }}>{format(d.value)}</span>
            </div>
            <div className="bar">
              <span style={{ width: `${Math.max(2, pct)}%`, background: accent }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
