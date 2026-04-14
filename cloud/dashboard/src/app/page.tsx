import { redirect } from "next/navigation";
import StatCard from "@/components/StatCard";
import UsageChart from "@/components/UsageChart";
import LiveUsage from "@/components/LiveUsage";
import UpgradePrompt from "@/components/UpgradePrompt";
import { getOverview } from "@/lib/api";
import { getServerSession } from "@/lib/auth";
import { formatDate, formatInt, formatPct, formatUsd } from "@/lib/format";
import { PLANS } from "@shared/pricing";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const overview = await getOverview();
  const { usage, billing, workspace, perProvider, dailySeries } = overview;
  const plan = PLANS[workspace.plan];
  const used = usage.used;
  const quotaPct = usage.included === 0 ? 0 : used / usage.included;
  const mrr = plan.baseMonthlyUsd > 0 ? plan.baseMonthlyUsd : 0;
  const avgCost = used > 0 ? (used * 0.012) / used : 0;

  const bars = dailySeries.map((d) => {
    const label = new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return { label, value: d.fetches, sub: formatUsd(d.costUsd) };
  });

  const topProvider = perProvider[0];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-medium tracking-tight">
            {workspace.name}
            <span className="ml-2 mono text-[12px]" style={{ color: "var(--text-mute)" }}>
              /{workspace.slug}
            </span>
          </h1>
          <span className={`badge ${workspace.plan === "free" ? "badge-warn" : "badge-accent"}`}>
            {plan.label} plan
          </span>
        </div>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
          Welcome back, {session.user.name ?? session.user.email}. Here's the pulse of your
          workspace — usage, spend, and who's hitting the API right now.
        </p>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="MRR"
          value={workspace.plan === "free" ? "$0" : formatUsd(mrr)}
          sub={workspace.plan === "free" ? "free tier" : `renews ${formatDate(billing.currentPeriodEnd)}`}
          accent={workspace.plan === "free" ? "var(--text-mute)" : undefined}
          dim={workspace.plan === "free"}
        />
        <StatCard
          label="Fetches this period"
          value={formatInt(used)}
          sub={`of ${formatInt(usage.included)} included`}
        />
        <StatCard
          label="Avg cost / fetch"
          value={formatUsd(avgCost)}
          sub="rolling 30d"
        />
        <StatCard
          label="Quota used"
          value={formatPct(quotaPct, 0)}
          sub={quotaPct >= 0.8 ? "upgrade soon" : "healthy"}
          accent={
            quotaPct >= 1 ? "var(--danger)" : quotaPct >= 0.8 ? "var(--warn)" : undefined
          }
        />
        <StatCard
          label="Rate limit"
          value={`${plan.rateLimitPerMin}/min`}
          sub="per API key"
        />
      </section>

      {(workspace.plan === "free" || quotaPct >= 1) && (
        <UpgradePrompt plan={workspace.plan} reason={quotaPct >= 1 ? "quota" : "free"} />
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
              30-day fetches
            </h2>
            <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
              {formatInt(dailySeries.reduce((a, b) => a + b.fetches, 0))} total
            </span>
          </div>
          <UsageChart data={bars} />
        </div>
        <div className="flex flex-col gap-3">
          <LiveUsage />
          <div className="card p-4 flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
              Top provider
            </div>
            {topProvider ? (
              <div className="flex items-baseline justify-between">
                <span className="font-medium mono">{topProvider.provider}</span>
                <span className="mono text-[11px]" style={{ color: "var(--text-dim)" }}>
                  {formatInt(topProvider.fetches)}
                </span>
              </div>
            ) : (
              <div className="text-xs" style={{ color: "var(--text-dim)" }}>
                No provider traffic yet.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {perProvider.slice(0, 6).map((p) => {
          const total = perProvider.reduce((a, b) => a + b.fetches, 0);
          const pct = total === 0 ? 0 : p.fetches / total;
          return (
            <div key={p.provider} className="card p-4 flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="font-medium mono text-sm">{p.provider}</span>
                <span className="mono text-[11px]" style={{ color: "var(--text-dim)" }}>
                  {formatInt(p.fetches)}
                </span>
              </div>
              <div className="bar">
                <span style={{ width: `${Math.max(3, pct * 100)}%` }} />
              </div>
              <div className="text-[11px] mono" style={{ color: "var(--text-mute)" }}>
                {formatPct(pct, 0)} of traffic
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
