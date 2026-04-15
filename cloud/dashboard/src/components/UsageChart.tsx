/**
 * Legacy shim — delegates to the new BarChart. Kept so any unchanged import
 * path continues to compile.
 */
import { BarChart, type ChartPoint } from "./Chart";

export type { ChartPoint as BarPoint };

export default function UsageChart({
  data,
  height = 160,
  accent = "var(--accent)",
  emptyLabel,
}: {
  data: ReadonlyArray<ChartPoint>;
  height?: number;
  accent?: string;
  emptyLabel?: string;
}) {
  return <BarChart data={data} height={height} accent={accent} emptyLabel={emptyLabel} />;
}
