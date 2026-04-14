import Link from "next/link";
import type { PlanId } from "@shared/types";

/**
 * Shown when user hits quota or is on Free. Uses the accent gradient so it
 * reads as an action, not a warning.
 */
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
        : "Upgrade for managed browser fetches.";

  const body =
    reason === "quota"
      ? "Upgrade to keep fetching. Overage pricing at $0.015/fetch on Pro, $0.01/fetch on Team."
      : reason === "seats"
        ? "Team plan includes 5 seats + $12/extra. Workspace billing is pro-rated."
        : "Free is capped at 100 fetches/day. Pro adds pooled provider keys, browser fallback, and 10k included fetches/mo.";

  return (
    <div
      className="card p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,90,31,0.10), rgba(255,90,31,0.02)) var(--bg-card)",
        borderColor: "rgba(255,90,31,0.35)",
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">{headline}</div>
        <p className="text-xs max-w-2xl" style={{ color: "var(--text-dim)" }}>
          {body}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link href="https://webfetch.dev/pricing" className="nav-link">
          See pricing
        </Link>
        <Link href="/billing" className="btn btn-primary">
          Upgrade
        </Link>
      </div>
    </div>
  );
}
