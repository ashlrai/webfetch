"use client";

import EmptyState from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { formatRelative, toCsv } from "@/lib/format";
import type { AuditEntry, UsageRow } from "@shared/types";
import { useEffect, useMemo, useState } from "react";

type Tab = "api" | "admin";

export default function AuditClient({ audit, usage }: { audit: AuditEntry[]; usage: UsageRow[] }) {
  const [tab, setTab] = useState<Tab>("api");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [action, setAction] = useState("all");
  const [detail, setDetail] = useState<UsageRow | AuditEntry | null>(null);

  // Close drawer on escape
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const uniqueActions = useMemo(() => Array.from(new Set(audit.map((a) => a.action))), [audit]);

  const filteredUsage = useMemo(
    () =>
      usage.filter((u) => {
        if (status !== "all" && String(u.status) !== status) return false;
        if (query && !u.endpoint.includes(query) && !u.requestId.includes(query)) return false;
        return true;
      }),
    [usage, status, query],
  );

  const filteredAudit = useMemo(
    () =>
      audit.filter((a) => {
        if (action !== "all" && a.action !== action) return false;
        if (query && !a.action.includes(query) && !(a.targetId ?? "").includes(query)) return false;
        return true;
      }),
    [audit, action, query],
  );

  const handleExport = () => {
    const rows =
      tab === "api"
        ? filteredUsage.map((u) => ({
            ts: new Date(u.ts).toISOString(),
            endpoint: u.endpoint,
            status: u.status,
            units: u.units,
            request_id: u.requestId,
            api_key_id: u.apiKeyId ?? "",
          }))
        : filteredAudit.map((a) => ({
            ts: new Date(a.ts).toISOString(),
            action: a.action,
            actor: a.actorUserId ?? "",
            target_type: a.targetType ?? "",
            target_id: a.targetId ?? "",
            meta: a.meta ?? "",
          }));
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webfetch-audit-${tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div
          className="inline-flex items-center p-0.5 rounded-[8px]"
          style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)" }}
        >
          {(["api", "admin"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 h-7 rounded-[6px] text-[12px] transition-colors"
              style={{
                background: tab === t ? "var(--bg-card)" : "transparent",
                color: tab === t ? "var(--text)" : "var(--text-dim)",
                border: tab === t ? "1px solid var(--border-mid)" : "1px solid transparent",
              }}
            >
              {t === "api" ? `API calls · ${usage.length}` : `Admin events · ${audit.length}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Icon
              name="search"
              className="absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-mute)" }}
            />
            <input
              className="input"
              style={{ paddingLeft: 28, width: 220 }}
              placeholder={
                tab === "api" ? "Search endpoint or request ID…" : "Search action or target…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {tab === "api" ? (
            <select
              className="select"
              style={{ width: 120 }}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All status</option>
              <option value="200">200</option>
              <option value="402">402</option>
              <option value="429">429</option>
              <option value="500">500</option>
            </select>
          ) : (
            <select
              className="select"
              style={{ width: 160 }}
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="all">All actions</option>
              {uniqueActions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-sm" onClick={handleExport}>
            <Icon name="download" /> Export CSV
          </button>
        </div>
      </div>

      {tab === "api" && usage.length === 0 ? (
        <EmptyState
          title="No API calls recorded yet."
          description="Every request to api.getwebfetch.com appears here in real time — endpoint, status, latency, and cost."
        />
      ) : tab === "admin" && audit.length === 0 ? (
        <EmptyState
          title="No admin events yet."
          description="Key rotations, member invites, plan changes, and provider updates will appear here once they happen."
        />
      ) : (
        <div className="surface overflow-hidden">
          <table className="data">
            <thead>
              {tab === "api" ? (
                <tr>
                  <th>Time</th>
                  <th>Endpoint</th>
                  <th>Status</th>
                  <th>Units</th>
                  <th>Request ID</th>
                </tr>
              ) : (
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Meta</th>
                </tr>
              )}
            </thead>
            <tbody>
              {tab === "api" ? (
                filteredUsage.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ textAlign: "center", color: "var(--text-dim)", padding: 40 }}
                    >
                      No rows match this filter.
                    </td>
                  </tr>
                ) : (
                  filteredUsage.map((u) => (
                    <tr key={u.id} style={{ cursor: "pointer" }} onClick={() => setDetail(u)}>
                      <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
                        {formatRelative(u.ts)}
                      </td>
                      <td className="mono">{u.endpoint}</td>
                      <td>
                        <span
                          className={`badge ${u.status >= 500 ? "badge-err" : u.status >= 400 ? "badge-warn" : "badge-ok"}`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="mono text-[12px]">{u.units}</td>
                      <td className="mono text-[11.5px]" style={{ color: "var(--text-mute)" }}>
                        {u.requestId}
                      </td>
                    </tr>
                  ))
                )
              ) : filteredAudit.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: "center", color: "var(--text-dim)", padding: 40 }}
                  >
                    No events match this filter.
                  </td>
                </tr>
              ) : (
                filteredAudit.map((a) => (
                  <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => setDetail(a)}>
                    <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
                      {formatRelative(a.ts)}
                    </td>
                    <td className="mono text-[11.5px]">{a.actorUserId ?? "system"}</td>
                    <td>
                      <span className="badge">{a.action}</span>
                    </td>
                    <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
                      {a.targetType ?? "—"}
                      {a.targetId ? `:${a.targetId}` : ""}
                    </td>
                    <td className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
                      {a.meta ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <>
          <div className="modal-backdrop" onClick={() => setDetail(null)} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Event detail">
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col">
                <span className="eyebrow">Event</span>
                <h2 className="h2">{"endpoint" in detail ? detail.endpoint : detail.action}</h2>
              </div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setDetail(null)}
                aria-label="Close"
              >
                <Icon name="x" />
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px] mb-4">
              <dt style={{ color: "var(--text-mute)" }}>ID</dt>
              <dd className="mono">{detail.id}</dd>
              <dt style={{ color: "var(--text-mute)" }}>When</dt>
              <dd className="mono">
                {new Date(detail.ts).toLocaleString()}{" "}
                <span style={{ color: "var(--text-mute)" }}>· {formatRelative(detail.ts)}</span>
              </dd>
              {"status" in detail && (
                <>
                  <dt style={{ color: "var(--text-mute)" }}>Status</dt>
                  <dd>
                    <span
                      className={`badge ${detail.status >= 500 ? "badge-err" : detail.status >= 400 ? "badge-warn" : "badge-ok"}`}
                    >
                      {detail.status}
                    </span>
                  </dd>
                  <dt style={{ color: "var(--text-mute)" }}>Request ID</dt>
                  <dd className="mono break-all">{detail.requestId}</dd>
                </>
              )}
              {"action" in detail && (
                <>
                  <dt style={{ color: "var(--text-mute)" }}>Action</dt>
                  <dd>
                    <span className="badge">{detail.action}</span>
                  </dd>
                  <dt style={{ color: "var(--text-mute)" }}>Actor</dt>
                  <dd className="mono">{detail.actorUserId ?? "system"}</dd>
                </>
              )}
            </dl>
            <div className="eyebrow mb-1.5">Raw JSON</div>
            <pre
              className="mono text-[11.5px] p-3 rounded-[8px] overflow-auto"
              style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border-mid)",
                maxHeight: "60vh",
              }}
            >
              {JSON.stringify(detail, null, 2)}
            </pre>
          </aside>
        </>
      )}
    </div>
  );
}
