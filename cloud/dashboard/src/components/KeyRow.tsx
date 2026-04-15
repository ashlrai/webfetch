"use client";

import { revokeKey } from "@/lib/api";
import { formatDate, formatRelative } from "@/lib/format";
import type { ApiKey } from "@shared/types";
import { useState } from "react";
import { Icon } from "./Icon";

export default function KeyRow({
  apiKey,
  onChange,
}: {
  apiKey: ApiKey;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoked = apiKey.revokedAt != null;

  const masked = `${apiKey.prefix}${"•".repeat(20)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey.prefix);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  };

  const handleRevoke = async () => {
    if (!confirm(`Revoke "${apiKey.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await revokeKey(apiKey.id);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr style={revoked ? { opacity: 0.48 } : undefined}>
      <td>
        <div className="flex items-center gap-2">
          <span className="font-medium text-[13px]">{apiKey.name}</span>
          {revoked && <span className="badge badge-err">revoked</span>}
        </div>
      </td>
      <td className="mono">
        <div className="inline-flex items-center gap-2">
          <span style={{ color: "var(--text-dim)" }}>{masked}</span>
          {!revoked && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={handleCopy}
              aria-label="Copy key prefix"
              title="Copy prefix"
            >
              <Icon name={copied ? "check" : "copy"} />
            </button>
          )}
        </div>
      </td>
      <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
        {formatDate(apiKey.createdAt)}
      </td>
      <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
        {apiKey.lastUsedAt ? formatRelative(apiKey.lastUsedAt) : "never"}
      </td>
      <td>
        <span className="badge">workspace</span>
      </td>
      <td style={{ textAlign: "right" }}>
        {!revoked && (
          <button
            className="btn btn-sm btn-danger"
            onClick={handleRevoke}
            disabled={busy}
            aria-label={`Revoke ${apiKey.name}`}
          >
            <Icon name="trash" /> {busy ? "Revoking" : "Revoke"}
          </button>
        )}
        {error && (
          <div className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}
