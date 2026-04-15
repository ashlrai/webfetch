"use client";

import { useState } from "react";
import type { WorkspaceRole, User } from "@shared/types";
import { formatRelative } from "@/lib/format";
import { removeMember } from "@/lib/api";
import { Icon } from "./Icon";

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

  const initial = (member.user.name ?? member.user.email).slice(0, 1).toUpperCase();

  return (
    <tr>
      <td>
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="size-7 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0"
            style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)", color: "var(--text-dim)" }}
          >
            {initial}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] truncate">{member.user.name ?? "—"}</span>
            <span className="mono text-[11px] truncate" style={{ color: "var(--text-mute)" }}>
              {member.user.email}
            </span>
          </div>
        </div>
      </td>
      <td>
        <span className={`badge ${roleClass[member.role]}`}>{member.role}</span>
      </td>
      <td>
        {pending ? (
          <span className="badge badge-warn">invite pending</span>
        ) : (
          <span className="badge badge-ok"><span className="dot" />active</span>
        )}
      </td>
      <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
        {formatRelative(member.acceptedAt ?? member.invitedAt)}
      </td>
      <td style={{ textAlign: "right" }}>
        {canManage && member.role !== "owner" && (
          <button className="btn btn-sm btn-danger" onClick={handleRemove} disabled={busy}>
            <Icon name="trash" /> {busy ? "Removing" : "Remove"}
          </button>
        )}
      </td>
    </tr>
  );
}
