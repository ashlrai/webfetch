export default function StatCard({
  label,
  value,
  sub,
  accent,
  dim = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  dim?: boolean;
}) {
  return (
    <div className={`card p-4${dim ? " stat-dim" : ""}`}>
      <div
        className="text-[11px] uppercase tracking-[0.08em]"
        style={{ color: "var(--text-mute)" }}
      >
        {label}
      </div>
      <div className="mt-1 text-2xl font-medium" style={{ color: accent ?? "var(--text)" }}>
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-xs mono" style={{ color: "var(--text-dim)" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}
