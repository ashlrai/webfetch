import { AreaChart, HBarList } from "@/components/Chart";
import { Icon } from "@/components/Icon";
import LiveUsage from "@/components/LiveUsage";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import UpgradePrompt from "@/components/UpgradePrompt";
import { getOverview, listKeys } from "@/lib/api";
import { getServerSession } from "@/lib/auth";
import { formatDate, formatInt, formatPct, formatRelative, formatUsd } from "@/lib/format";
import { PLANS } from "@shared/pricing";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [overview, keys] = await Promise.all([getOverview(), listKeys().catch(() => [])]);
  const { usage, billing, workspace, perProvider, dailySeries } = overview;
  const plan = PLANS[workspace.plan];
  const isFirstRun = keys.length === 0 && usage.used === 0;

  const used = usage.used;
  const quotaPct = usage.included === 0 ? 0 : used / usage.included;
  const mrr = plan.baseMonthlyUsd > 0 ? plan.baseMonthlyUsd : 0;
  const avgCost = 0.012;

  // 14-day sparkline window
  const spark = dailySeries.slice(-14).map((d) => d.fetches);
  const sparkCost = dailySeries.slice(-14).map((d) => d.costUsd);
  const totalCost = dailySeries.reduce((a, b) => a + b.costUsd, 0);

  // delta: compare last 7d vs previous 7d
  const last7 = dailySeries.slice(-7).reduce((a, b) => a + b.fetches, 0);
  const prev7 = dailySeries.slice(-14, -7).reduce((a, b) => a + b.fetches, 0) || 1;
  const delta7 = ((last7 - prev7) / prev7) * 100;

  const bars = dailySeries.map((d) => ({
    label: new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    value: d.fetches,
    sub: formatUsd(d.costUsd),
  }));

  const topProviders = perProvider.slice(0, 6);

  const activityFeed = isFirstRun
    ? []
    : [
        { t: "2m ago", label: "Key used: wf_live_8Kq…", sub: "GET /v1/search" },
        { t: "14m ago", label: "Pro plan renewed", sub: formatUsd(plan.baseMonthlyUsd) },
        { t: "1h ago", label: "Member invited", sub: "editor@ashlr.ai" },
        { t: "3h ago", label: "Provider key added", sub: "unsplash · BYOK" },
        {
          t: "yesterday",
          label: "Quota 80% warning sent",
          sub: `${formatInt(used)} of ${formatInt(usage.included)}`,
        },
      ];

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title={workspace.name}
        description={`Welcome back, ${session.user.name ?? session.user.email}. Here's what's happening in your workspace right now.`}
        badge={
          <span className={`badge ${workspace.plan === "free" ? "badge-warn" : "badge-accent"}`}>
            {plan.label}
          </span>
        }
        actions={
          <>
            <Link href="/usage" className="btn btn-sm">
              <Icon name="bar" /> Usage
            </Link>
            <Link href="/keys" className="btn btn-sm btn-primary">
              <Icon name="plus" /> New key
            </Link>
          </>
        }
      />

      {/* Stat strip */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <StatCard
          icon="card"
          label="MRR"
          value={workspace.plan === "free" ? "$0" : formatUsd(mrr)}
          sub={
            workspace.plan === "free"
              ? "free tier"
              : `renews ${formatDate(billing.currentPeriodEnd)}`
          }
          dim={workspace.plan === "free"}
        />
        <StatCard
          icon="bar"
          label="Fetches / period"
          value={formatInt(used)}
          sub={`of ${formatInt(usage.included)} included`}
          spark={spark}
          delta={{ value: delta7 }}
        />
        <StatCard
          icon="download"
          label="Avg cost / fetch"
          value={formatUsd(avgCost)}
          sub={`${formatUsd(totalCost)} last 30d`}
          spark={sparkCost.map((c) => Math.round(c * 100))}
        />
        <StatCard
          icon="info"
          label="Quota used"
          value={formatPct(quotaPct, 0)}
          sub={quotaPct >= 0.8 ? "upgrade soon" : "healthy"}
          accent={quotaPct >= 1 ? "var(--danger)" : quotaPct >= 0.8 ? "var(--warn)" : undefined}
        />
        <StatCard
          icon="clock"
          label="Rate limit"
          value={`${plan.rateLimitPerMin}`}
          sub="req/min per key"
        />
        <StatCard
          icon="users"
          label="Seats used"
          value={`3 / ${plan.seats}`}
          sub="2 admins, 1 pending"
        />
      </section>

      {isFirstRun && (
        <section className="surface p-5 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="eyebrow">Welcome</span>
              <h2 className="h2">Create your first API key</h2>
              <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
                Your workspace is empty. Mint an API key to call
                <code className="mono mx-1">api.getwebfetch.com</code>
                from the CLI, MCP server, or your own code. Free tier includes
                100 fetches / day — no card required.
              </p>
            </div>
            <Link href="/keys" className="btn btn-primary btn-lg shrink-0">
              <Icon name="plus" /> Create key
            </Link>
          </div>
          <ol
            className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1 text-[12.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            {[
              ["1", "Create a key", "Save the secret — shown once."],
              ["2", "Curl /v1/search", "Usage appears in /usage live."],
              ["3", "Invite teammates", "Share the workspace from /team."],
            ].map(([n, title, sub]) => (
              <li key={n} className="flex items-start gap-2">
                <span
                  className="size-5 rounded-full flex items-center justify-center mono text-[11px] shrink-0"
                  style={{ background: "var(--bg-elev)", color: "var(--text)" }}
                >
                  {n}
                </span>
                <div className="flex flex-col min-w-0">
                  <span style={{ color: "var(--text)" }}>{title}</span>
                  <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
                    {sub}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!isFirstRun && (workspace.plan === "free" || quotaPct >= 1) && (
        <UpgradePrompt plan={workspace.plan} reason={quotaPct >= 1 ? "quota" : "free"} />
      )}

      {/* Chart + Live + Top providers */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="h2">Fetches · 30 days</h2>
            <div
              className="flex items-center gap-3 text-[11.5px] mono"
              style={{ color: "var(--text-mute)" }}
            >
              <span>{formatInt(dailySeries.reduce((a, b) => a + b.fetches, 0))} total</span>
              <span>peak {formatInt(Math.max(...dailySeries.map((d) => d.fetches)))}</span>
            </div>
          </div>
          <AreaChart data={bars} height={220} format={formatInt} />
        </div>
        <LiveUsage />
      </section>

      {/* Top providers + Recent activity */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 surface p-4 flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="h2">Top providers</h2>
            <Link href="/providers" className="text-[12px]" style={{ color: "var(--text-dim)" }}>
              Manage →
            </Link>
          </div>
          {topProviders.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-8 gap-1"
              style={{ color: "var(--text-mute)" }}
            >
              <span className="text-[13px]" style={{ color: "var(--text-dim)" }}>
                No provider data yet.
              </span>
              <span className="mono text-[11px]">Fetches break down by provider once you start calling the API.</span>
            </div>
          ) : (
            <HBarList
              data={topProviders.map((p) => ({ label: p.provider, value: p.fetches }))}
              format={formatInt}
            />
          )}
        </div>

        <div className="lg:col-span-2 surface p-4 flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="h2">Recent activity</h2>
            <Link href="/audit" className="text-[12px]" style={{ color: "var(--text-dim)" }}>
              View all →
            </Link>
          </div>
          {activityFeed.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-8 gap-1"
              style={{ color: "var(--text-mute)" }}
            >
              <span className="text-[13px]" style={{ color: "var(--text-dim)" }}>
                Activity starts here.
              </span>
              <span className="mono text-[11px]">Make your first API call to see events.</span>
            </div>
          ) : (
            <ul className="flex flex-col">
              {activityFeed.map((a, i) => (
                <li
                  key={i}
                  className="flex items-start justify-between gap-3 py-2 border-b last:border-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] truncate">{a.label}</span>
                    <span className="mono text-[11px] truncate" style={{ color: "var(--text-mute)" }}>
                      {a.sub}
                    </span>
                  </div>
                  <span className="mono text-[11px] shrink-0" style={{ color: "var(--text-mute)" }}>
                    {a.t}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Quota meter footer strip */}
      <section className="surface p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Quota</span>
            <span className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
              {formatInt(used)} / {formatInt(usage.included)} · resets{" "}
              {formatRelative(workspace.quotaResetsAt)}
            </span>
          </div>
          <span
            className="mono text-[12px]"
            style={{ color: quotaPct >= 0.8 ? "var(--warn)" : "var(--text-dim)" }}
          >
            {formatPct(quotaPct, 1)}
          </span>
        </div>
        <div className="bar">
          <span
            style={{
              width: `${Math.min(100, quotaPct * 100)}%`,
              background:
                quotaPct >= 1 ? "var(--danger)" : quotaPct >= 0.8 ? "var(--warn)" : "var(--accent)",
            }}
          />
        </div>
      </section>
    </div>
  );
}
