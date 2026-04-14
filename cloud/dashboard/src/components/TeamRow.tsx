"use client";

import { useState } from "react";
import type { WorkspaceRole, User } from "@shared/types";
import { formatRelative } from "@/lib/format";
import { removeMember } from "@/lib/api";

interface RowMember {
  userId: string;
  role: WorkspaceRole;
  invitedAt: number;
  acceptedAt: number | null;
  user: User;
}

export default function TeamRow({
  member,
  canManage,
  onChange,
}: {
  member: RowMember;
  canManage: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = member.acceptedAt == null;

  const handleRemove = async () => {
    if (!confirm(`Remove ${member.user.email}?`)) return;
    setBusy(true);
    try {
      await removeMember(member.userId);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const roleClass: Record<WorkspaceRole, string> = {
    owner: "badge-accent",
    admin: "badge-info",
    member: "",
    billing: "badge-warn",
    readonly: "",
  };

  return (
    <tr>
      <td>
        <div className="flex flex-col">
          <span>{member.user.name ?? "—"}</span>
          <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
            {member.user.email}
          </span>
        </div>
      </td>
      <td>
        <span className={`badge ${roleClass[member.role]}`}>{member.role}</span>
      </td>
      <td>
        {pending ? (
          <span className="badge badge-warn">invite pending</span>
        ) : (
          <span className="badge badge-ok">active</span>
        )}
      </td>
      <td className="mono text-[11px]" style={{ color: "var(--text-dim)" }}>
        {formatRelative(member.acceptedAt ?? member.invitedAt)}
      </td>
      <td style={{ textAlign: "right" }}>
        {canManage && member.role !== "owner" && (
          <button className="btn btn-danger" onClick={handleRemove} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </button>
        )}
      </td>
    </tr>
  );
}
