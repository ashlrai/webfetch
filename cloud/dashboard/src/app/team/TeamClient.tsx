"use client";

import EmptyState from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import TeamRow from "@/components/TeamRow";
import UpgradePrompt from "@/components/UpgradePrompt";
import { inviteMember, listMembers } from "@/lib/api";
import type { PlanId, User, WorkspaceRole } from "@shared/types";
import { useState, useTransition } from "react";

interface RowMember {
  userId: string;
  role: WorkspaceRole;
  invitedAt: number;
  acceptedAt: number | null;
  user: User;
}

export default function TeamClient({
  initialMembers,
  planId,
  seatLimit,
  currentUserId,
}: {
  initialMembers: RowMember[];
  planId: PlanId;
  seatLimit: number;
  currentUserId: string;
}) {
  const [members, setMembers] = useState<RowMember[]>(initialMembers);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const atCap = members.length >= seatLimit;
  const owner = members.find((m) => m.role === "owner");
  const canManage =
    owner?.userId === currentUserId ||
    members.find((m) => m.userId === currentUserId)?.role === "admin";

  const refresh = () =>
    startTransition(async () => {
      const next = await listMembers();
      setMembers(next);
    });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setOk(null);
    try {
      await inviteMember(email.trim(), role);
      setOk(`Invite sent to ${email.trim()}.`);
      setEmail("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    }
  };

  const pct = Math.min(100, (members.length / seatLimit) * 100);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="surface p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Seats used</span>
            <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
              {members.length} / {seatLimit}
            </span>
          </div>
          <div className="num-md">{members.length}</div>
          <div className="bar">
            <span
              style={{ width: `${pct}%`, background: pct >= 100 ? "var(--warn)" : "var(--accent)" }}
            />
          </div>
        </div>
        <div className="surface p-4 flex flex-col gap-1">
          <span className="eyebrow">Pending invites</span>
          <div className="num-md">{members.filter((m) => m.acceptedAt == null).length}</div>
          <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
            invites expire in 7 days
          </span>
        </div>
        <div className="surface p-4 flex flex-col gap-1">
          <span className="eyebrow">Admins</span>
          <div className="num-md">
            {members.filter((m) => m.role === "admin" || m.role === "owner").length}
          </div>
          <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
            can manage keys + members
          </span>
        </div>
      </div>

      {atCap && <UpgradePrompt plan={planId} reason="seats" />}

      {canManage && (
        <form
          className="surface p-4 flex flex-col md:flex-row items-start md:items-end gap-3"
          onSubmit={handleInvite}
        >
          <label className="flex flex-col gap-1.5 flex-1 min-w-0 w-full">
            <span className="eyebrow">Invite by email</span>
            <input
              type="email"
              className="input"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5 w-full md:w-[180px]">
            <span className="eyebrow">Role</span>
            <select
              className="select"
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
              <option value="billing">billing-only</option>
              <option value="readonly">read-only</option>
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={atCap}>
            <Icon name="plus" /> Send invite
          </button>
        </form>
      )}

      {error && (
        <div className="text-[12px] mono" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {ok && (
        <div className="text-[12px] mono flex items-center gap-2" style={{ color: "var(--ok)" }}>
          <Icon name="check" /> {ok}
        </div>
      )}

      {members.length === 0 ? (
        <EmptyState
          title="No teammates yet."
          description="Invite someone to share keys, usage, and billing. Roles let you limit who can rotate keys or change plans."
          action={
            canManage ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  document.querySelector<HTMLInputElement>('input[type="email"]')?.focus()
                }
              >
                <Icon name="plus" /> Invite a teammate
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="surface overflow-hidden">
          <table className="data">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <TeamRow key={m.userId} member={m} canManage={!!canManage} onChange={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <div className="text-[11px] mono" style={{ color: "var(--text-mute)" }}>
          refreshing…
        </div>
      )}
    </>
  );
}
