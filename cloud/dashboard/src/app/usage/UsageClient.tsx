"use client";

import { useMemo, useState } from "react";
import UsageChart from "@/components/UsageChart";
import { formatInt, formatUsd, toCsv } from "@/lib/format";

type Range = "7d" | "30d" | "90d" | "custom";

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
    value: Math.round(d.costUsd * 1000),
    sub: formatUsd(d.costUsd),
  }));

  const endpointBars = perEndpoint
    .filter((e) => endpointFilter === "all" || e.endpoint === endpointFilter)
    .map((e) => ({ label: e.endpoint, value: e.fetches }));

  const providerBars = perProvider.map((p) => ({ label: p.provider, value: p.fetches }));

  const totalFetches = filtered.reduce((a, b) => a + b.fetches, 0);
  const totalCost = filtered.reduce((a, b) => a + b.costUsd, 0);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(["7d", "30d", "90d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="nav-link"
              data-active={range === r}
            >
              {r}
            </button>
          ))}
          <select
            className="select"
            style={{ width: "auto" }}
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
        <div className="flex items-center gap-3">
          <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
            {formatInt(totalFetches)} fetches · {formatUsd(totalCost)}
          </span>
          <button className="btn" onClick={handleExport}>
            Export CSV
          </button>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
          Daily fetches
        </h2>
        <UsageChart data={dailyBars} height={180} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Per endpoint
          </h2>
          <UsageChart data={endpointBars} height={160} accent="var(--info)" />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Per provider
          </h2>
          <UsageChart data={providerBars} height={160} accent="#ffb088" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
          Daily cost (USD · ×1000)
        </h2>
        <UsageChart data={costBars} height={140} accent="var(--warn)" />
      </section>
    </div>
  );
}
