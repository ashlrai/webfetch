"use client";

import { useState } from "react";
import type { ApiKey } from "@shared/types";
import { formatDate, formatRelative, maskKey } from "@/lib/format";
import { revokeKey } from "@/lib/api";

export default function KeyRow({
  apiKey,
  onChange,
}: {
  apiKey: ApiKey;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoked = apiKey.revokedAt != null;

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
    <tr style={revoked ? { opacity: 0.55 } : undefined}>
      <td>
        <div className="flex items-center gap-2">
          <span>{apiKey.name}</span>
          {revoked && <span className="badge badge-err">revoked</span>}
        </div>
      </td>
      <td className="mono">{maskKey(apiKey.prefix)}</td>
      <td className="mono text-[11px]" style={{ color: "var(--text-dim)" }}>
        {formatDate(apiKey.createdAt)}
      </td>
      <td className="mono text-[11px]" style={{ color: "var(--text-dim)" }}>
        {apiKey.lastUsedAt ? formatRelative(apiKey.lastUsedAt) : "never"}
      </td>
      <td>
        <span className="badge">workspace</span>
      </td>
      <td style={{ textAlign: "right" }}>
        {!revoked && (
          <button
            className="btn btn-danger"
            onClick={handleRevoke}
            disabled={busy}
            aria-label={`Revoke ${apiKey.name}`}
          >
            {busy ? "Revoking…" : "Revoke"}
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
