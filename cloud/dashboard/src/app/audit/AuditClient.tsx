"use client";

import { useMemo, useState } from "react";
import type { AuditEntry, UsageRow } from "@shared/types";
import { formatRelative, toCsv } from "@/lib/format";

type Tab = "api" | "admin";

export default function AuditClient({ audit, usage }: { audit: AuditEntry[]; usage: UsageRow[] }) {
  const [tab, setTab] = useState<Tab>("api");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [action, setAction] = useState("all");
  const [detail, setDetail] = useState<UsageRow | AuditEntry | null>(null);

  const uniqueActions = useMemo(
    () => Array.from(new Set(audit.map((a) => a.action))),
    [audit],
  );

  const filteredUsage = useMemo(() => {
    return usage.filter((u) => {
      if (status !== "all" && String(u.status) !== status) return false;
      if (query && !u.endpoint.includes(query) && !u.requestId.includes(query)) return false;
      return true;
    });
  }, [usage, status, query]);

  const filteredAudit = useMemo(() => {
    return audit.filter((a) => {
      if (action !== "all" && a.action !== action) return false;
      if (query && !a.action.includes(query) && !(a.targetId ?? "").includes(query)) return false;
      return true;
    });
  }, [audit, action, query]);

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
        <div className="flex items-center gap-2">
          <button className="nav-link" data-active={tab === "api"} onClick={() => setTab("api")}>
            API calls ({usage.length})
          </button>
          <button className="nav-link" data-active={tab === "admin"} onClick={() => setTab("admin")}>
            Admin events ({audit.length})
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {tab === "api" ? (
            <select
              className="select"
              style={{ width: "auto" }}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="200">200</option>
              <option value="402">402</option>
              <option value="429">429</option>
              <option value="500">500</option>
            </select>
          ) : (
            <select
              className="select"
              style={{ width: "auto" }}
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
          <button className="btn" onClick={handleExport}>
            Export CSV
          </button>
        </div>
      </div>

      {tab === "api" ? (
        <div className="card p-0 overflow-hidden">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Units</th>
                <th>Request ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsage.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-dim)", padding: 40 }}>
                    No rows match this filter.
                  </td>
                </tr>
              ) : (
                filteredUsage.map((u) => (
                  <tr
                    key={u.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setDetail(u)}
                  >
                    <td className="mono text-[11px]" style={{ color: "var(--text-dim)" }}>
                      {formatRelative(u.ts)}
                    </td>
                    <td className="mono">{u.endpoint}</td>
                    <td>
                      <span
                        className={`badge ${
                          u.status >= 500 ? "badge-err" : u.status >= 400 ? "badge-warn" : "badge-ok"
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="mono text-[11px]">{u.units}</td>
                    <td className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
                      {u.requestId}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {filteredAudit.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-dim)", padding: 40 }}>
                    No events match this filter.
                  </td>
                </tr>
              ) : (
                filteredAudit.map((a) => (
                  <tr
                    key={a.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setDetail(a)}
                  >
                    <td className="mono text-[11px]" style={{ color: "var(--text-dim)" }}>
                      {formatRelative(a.ts)}
                    </td>
                    <td className="mono text-[11px]">{a.actorUserId ?? "system"}</td>
                    <td>
                      <span className="badge">{a.action}</span>
                    </td>
                    <td className="mono text-[11px]" style={{ color: "var(--text-dim)" }}>
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
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-medium">Event detail</h2>
              <button className="btn" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
            <pre
              className="mono text-[12px]"
              style={{ background: "var(--bg-elev)", padding: 12, borderRadius: 10, overflow: "auto", maxHeight: 400 }}
            >
              {JSON.stringify(detail, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
