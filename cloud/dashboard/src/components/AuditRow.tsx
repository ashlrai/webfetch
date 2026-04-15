import { formatRelative } from "@/lib/format";
import type { AuditEntry } from "@shared/types";

export default function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <tr>
      <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
        {formatRelative(entry.ts)}
      </td>
      <td className="mono text-[11.5px]">{entry.actorUserId ?? "system"}</td>
      <td>
        <span className="badge">{entry.action}</span>
      </td>
      <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
        {entry.targetType ?? "—"}
        {entry.targetId ? `:${entry.targetId}` : ""}
      </td>
      <td className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
        {entry.meta ?? "—"}
      </td>
    </tr>
  );
}
