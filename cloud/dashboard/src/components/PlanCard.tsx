import type { PlanId } from "@shared/types";
import { PLANS } from "@shared/pricing";
import { formatInt, formatUsd } from "@/lib/format";

export default function PlanCard({
  plan,
  current = false,
  cta,
}: {
  plan: PlanId;
  current?: boolean;
  cta?: React.ReactNode;
}) {
  const cfg = PLANS[plan];
  const priceLabel =
    cfg.baseMonthlyUsd < 0 ? "Contact us" : cfg.baseMonthlyUsd === 0 ? "Free" : `${formatUsd(cfg.baseMonthlyUsd)}/mo`;

  return (
    <div
      className="card p-5 flex flex-col gap-4"
      style={
        current
          ? { borderColor: "rgba(255,90,31,0.5)", boxShadow: "0 0 0 1px rgba(255,90,31,0.25)" }
          : undefined
      }
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            {cfg.label}
          </div>
          <div className="mt-1 text-2xl font-medium">{priceLabel}</div>
          {cfg.extraSeatUsd > 0 && (
            <div className="text-xs mono" style={{ color: "var(--text-dim)" }}>
              + {formatUsd(cfg.extraSeatUsd)}/extra seat
            </div>
          )}
        </div>
        {current && <span className="badge badge-accent">current</span>}
      </div>

      <ul className="flex flex-col gap-2 text-sm">
        <Row label="Included fetches" value={`${formatInt(cfg.includedFetches)} / ${cfg.window === "daily" ? "day" : "mo"}`} />
        <Row label="Overage" value={cfg.overageUsd < 0 ? "—" : `${formatUsd(cfg.overageUsd)}/fetch`} />
        <Row label="Rate limit" value={`${cfg.rateLimitPerMin}/min`} />
        <Row label="Seats" value={String(cfg.seats)} />
        <Row label="Browser fallback" value={cfg.allowedEndpoints.includes("/v1/similar") ? "Yes" : "—"} />
      </ul>

      {cta && <div className="pt-2">{cta}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between">
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span className="mono text-[12px]">{value}</span>
    </li>
  );
}
