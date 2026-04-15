/**
 * Micro inline-SVG sparkline. Pure stateless, no deps, scales on width prop.
 */
export default function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = "var(--accent)",
  fill = "rgba(255,90,31,0.12)",
}: {
  values: ReadonlyArray<number>;
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}) {
  if (!values.length) return <svg width={width} height={height} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={area} fill={fill} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
