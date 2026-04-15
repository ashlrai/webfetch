import Sparkline from "./Sparkline";
import { Icon, type IconName } from "./Icon";

export default function StatCard({
  label,
  value,
  sub,
  accent,
  dim = false,
  delta,
  spark,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  dim?: boolean;
  delta?: { value: number; label?: string } | null;
  spark?: ReadonlyArray<number>;
  icon?: IconName;
}) {
  const deltaUp = delta && delta.value >= 0;
  const deltaColor = !delta ? undefined : deltaUp ? "var(--ok)" : "var(--danger)";

  return (
    <div className={`surface p-4 flex flex-col gap-2${dim ? " stat-dim" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="eyebrow flex items-center gap-1.5">
          {icon && <Icon name={icon} size={11} />}
          {label}
        </div>
        {delta && (
          <span className="mono text-[11px] inline-flex items-center gap-1" style={{ color: deltaColor }}>
            <Icon name={deltaUp ? "arrow-up" : "arrow-down"} size={10} />
            {Math.abs(delta.value).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="num-lg" style={{ color: accent ?? "var(--text)" }}>{value}</div>
        {spark && spark.length > 0 && (
          <Sparkline values={spark} width={80} height={24} stroke={accent ?? "var(--accent)"} fill="rgba(255,90,31,0.10)" />
        )}
      </div>
      {sub && (
        <div className="text-[11.5px] mono" style={{ color: "var(--text-mute)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
