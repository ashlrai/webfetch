import type { PlanId } from "@shared/types";
import Link from "next/link";
import { Icon } from "./Icon";

export default function UpgradePrompt({
  plan,
  reason = "quota",
}: {
  plan: PlanId;
  reason?: "quota" | "free" | "seats";
}) {
  if (plan === "enterprise") return null;

  const headline =
    reason === "quota"
      ? "You've hit your plan quota."
      : reason === "seats"
        ? "You're out of seats on this plan."
        : "You're on the Free tier.";

  const body =
    reason === "quota"
      ? "Upgrade to keep fetching. Overage runs $0.015/fetch on Pro, $0.01 on Team."
      : reason === "seats"
        ? "Team plan includes 5 seats + $12/extra. Workspace billing is pro-rated."
        : "Pro adds pooled provider keys, browser fallback, and 10k included fetches/mo.";

  return (
    <div
      className="surface flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,90,31,0.08), transparent 120%), var(--bg-card)",
        borderColor: "rgba(255,90,31,0.3)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="size-8 rounded-[8px] flex items-center justify-center shrink-0"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <Icon name={reason === "quota" ? "alert" : "arrow-up"} />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="text-[14px] font-medium">{headline}</div>
          <p className="text-[12.5px] max-w-[60ch]" style={{ color: "var(--text-dim)" }}>
            {body}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link href="https://getwebfetch.com/pricing" className="btn btn-sm">
          Compare plans
        </Link>
        <Link href="/billing" className="btn btn-sm btn-primary">
          Upgrade <Icon name="arrow-up" size={11} />
        </Link>
      </div>
    </div>
  );
}
