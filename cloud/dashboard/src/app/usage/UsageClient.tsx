"use client";

import { AreaChart, BarChart, HBarList } from "@/components/Chart";
import EmptyState from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { formatInt, formatUsd, toCsv } from "@/lib/format";
import Link from "next/link";
import { useMemo, useState } from "react";

type Range = "7d" | "30d" | "90d";

interface Props {
  dailySeries: { day: number; fetches: number; costUsd: number }[];
  perEndpoint: { endpoint: string; fetches: number }[];
  perProvider: { provider: string; fetches: number }[];
}

export default function UsageClient({ dailySeries, perEndpoint, perProvider }: Props) {
  const [range, setRange] = useState<Range>("30d");
  const [endpointFilter, setEndpointFilter] = useState("all");

  const filtered = useMemo(() => {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    return dailySeries.slice(-days);
  }, [dailySeries, range]);

  const dailyBars = filtered.map((d) => ({
    label: new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    value: d.fetches,
    sub: formatUsd(d.costUsd),
  }));

  const costBars = filtered.map((d) => ({
    label: new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    value: Math.round(d.costUsd * 100), // cents
    sub: formatUsd(d.costUsd),
  }));

  const totalFetches = filtered.reduce((a, b) => a + b.fetches, 0);
  const totalCost = filtered.reduce((a, b) => a + b.costUsd, 0);
  const peakDay = filtered.reduce(
    (best, d) => (d.fetches > best.fetches ? d : best),
    filtered[0] ?? { fetches: 0, day: 0, costUsd: 0 },
  );

  const handleExport = () => {
    const csv = toCsv(
      filtered.map((d) => ({
        date: new Date(d.day).toISOString().slice(0, 10),
        fetches: d.fetches,
        cost_usd: d.costUsd.toFixed(4),
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webfetch-usage-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const endpoints =
    endpointFilter === "all"
      ? perEndpoint
      : perEndpoint.filter((e) => e.endpoint === endpointFilter);

  const hasData = dailySeries.some((d) => d.fetches > 0);

  if (!hasData) {
    return (
      <EmptyState
        title="No fetches in this period."
        description="Charts populate as soon as your API key makes its first call. Grab a key and run the curl below to see data here."
        action={
          <Link href="/keys" className="btn btn-primary">
            <Icon name="plus" /> Go to API keys
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div
          className="inline-flex items-center p-0.5 rounded-[8px]"
          style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)" }}
        >
          {(["7d", "30d", "90d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="px-3 h-7 rounded-[6px] text-[12px] mono transition-colors"
              style={{
                background: range === r ? "var(--bg-card)" : "transparent",
                color: range === r ? "var(--text)" : "var(--text-dim)",
                border: range === r ? "1px solid var(--border-mid)" : "1px solid transparent",
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="inline-flex items-center gap-1.5 px-2 h-8 rounded-[8px] text-[12px] mono"
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-mid)",
              color: "var(--text-dim)",
            }}
          >
            <Icon name="filter" />
            <select
              className="bg-transparent outline-none"
              style={{ color: "var(--text)" }}
              value={endpointFilter}
              onChange={(e) => setEndpointFilter(e.target.value)}
            >
              <option value="all">All endpoints</option>
              {perEndpoint.map((e) => (
                <option key={e.endpoint} value={e.endpoint}>
                  {e.endpoint}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-sm" onClick={handleExport}>
            <Icon name="download" /> Export CSV
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Fetches" value={formatInt(totalFetches)} sub={`${range} window`} />
        <Stat label="Cost" value={formatUsd(totalCost)} sub={`${range} window`} />
        <Stat
          label="Peak day"
          value={formatInt(peakDay.fetches)}
          sub={new Date(peakDay.day).toLocaleDateString()}
        />
        <Stat
          label="Avg / day"
          value={formatInt(Math.round(totalFetches / Math.max(1, filtered.length)))}
          sub={`${filtered.length} days`}
        />
      </div>

      {/* Daily chart */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="h2">Daily fetches</h2>
          <span className="mono text-[11.5px]" style={{ color: "var(--text-mute)" }}>
            {filtered.length} days
          </span>
        </div>
        <AreaChart data={dailyBars} height={220} format={formatInt} />
      </section>

      {/* Per-endpoint + per-provider */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="surface p-4 flex flex-col gap-3">
          <h2 className="h2">Per endpoint</h2>
          <HBarList
            data={endpoints.map((e) => ({ label: e.endpoint, value: e.fetches }))}
            format={formatInt}
            accent="var(--info)"
          />
        </div>
        <div className="surface p-4 flex flex-col gap-3">
          <h2 className="h2">Per provider</h2>
          <HBarList
            data={perProvider.map((p) => ({ label: p.provider, value: p.fetches }))}
            format={formatInt}
            accent="var(--accent)"
          />
        </div>
      </section>

      {/* Cost chart */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="h2">Daily cost</h2>
          <span className="mono text-[11.5px]" style={{ color: "var(--text-mute)" }}>
            USD · cents per bar
          </span>
        </div>
        <BarChart
          data={costBars}
          height={160}
          accent="var(--warn)"
          format={(v) => `$${(v / 100).toFixed(2)}`}
        />
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="surface p-3.5 flex flex-col gap-1">
      <div className="eyebrow">{label}</div>
      <div className="num-md">{value}</div>
      {sub && (
        <div className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
