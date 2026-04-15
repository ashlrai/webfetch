import { formatInt, formatUsd } from "@/lib/format";
import { PLANS } from "@shared/pricing";
import type { PlanId } from "@shared/types";
import { Icon } from "./Icon";

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
    cfg.baseMonthlyUsd < 0
      ? "Contact us"
      : cfg.baseMonthlyUsd === 0
        ? "Free"
        : `${formatUsd(cfg.baseMonthlyUsd)}`;
  const priceUnit = cfg.baseMonthlyUsd > 0 ? "/mo" : "";

  return (
    <div
      className="surface p-5 flex flex-col gap-4"
      style={current ? { borderColor: "rgba(255,90,31,0.45)" } : undefined}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <div className="eyebrow">{cfg.label}</div>
          <div className="flex items-baseline gap-1">
            <span className="text-[28px] font-medium tracking-tight">{priceLabel}</span>
            {priceUnit && (
              <span className="text-[13px]" style={{ color: "var(--text-mute)" }}>
                {priceUnit}
              </span>
            )}
          </div>
          {cfg.extraSeatUsd > 0 && (
            <div className="text-[11.5px] mono" style={{ color: "var(--text-mute)" }}>
              +{formatUsd(cfg.extraSeatUsd)}/extra seat
            </div>
          )}
        </div>
        {current && <span className="badge badge-accent">current</span>}
      </div>

      <div className="rule" />

      <ul className="flex flex-col gap-2 text-[13px]">
        <Row
          label="Included fetches"
          value={`${formatInt(cfg.includedFetches)} / ${cfg.window === "daily" ? "day" : "mo"}`}
        />
        <Row
          label="Overage"
          value={cfg.overageUsd < 0 ? "—" : `${formatUsd(cfg.overageUsd)}/fetch`}
        />
        <Row label="Rate limit" value={`${cfg.rateLimitPerMin}/min`} />
        <Row label="Seats" value={String(cfg.seats)} />
        <Row
          label="Browser fallback"
          value={
            cfg.allowedEndpoints.includes("/v1/similar") ? (
              <span className="inline-flex items-center gap-1" style={{ color: "var(--ok)" }}>
                <Icon name="check" size={11} /> Yes
              </span>
            ) : (
              "—"
            )
          }
        />
      </ul>

      {cta && <div className="pt-1">{cta}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between">
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span className="mono text-[12px]">{value}</span>
    </li>
  );
}
