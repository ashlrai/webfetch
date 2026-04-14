"use client";

import { useState, useTransition } from "react";
import type { PlanId, User, WorkspaceRole } from "@shared/types";
import TeamRow from "@/components/TeamRow";
import UpgradePrompt from "@/components/UpgradePrompt";
import { inviteMember, listMembers } from "@/lib/api";

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
  const canManage = owner?.userId === currentUserId || members.find((m) => m.userId === currentUserId)?.role === "admin";

  const refresh = () => {
    startTransition(async () => {
      const next = await listMembers();
      setMembers(next);
    });
  };

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

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Seats used
          </div>
          <div className="mt-1 text-2xl font-medium">
            {members.length} / {seatLimit}
          </div>
          <div className="mt-2 bar">
            <span style={{ width: `${Math.min(100, (members.length / seatLimit) * 100)}%` }} />
          </div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Pending invites
          </div>
          <div className="mt-1 text-2xl font-medium">
            {members.filter((m) => m.acceptedAt == null).length}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Admins
          </div>
          <div className="mt-1 text-2xl font-medium">
            {members.filter((m) => m.role === "admin" || m.role === "owner").length}
          </div>
        </div>
      </div>

      {atCap && <UpgradePrompt plan={planId} reason="seats" />}

      {canManage && (
        <form
          className="card p-4 flex flex-col md:flex-row items-start md:items-end gap-3"
          onSubmit={handleInvite}
        >
          <label className="flex flex-col gap-1 flex-1 min-w-0 w-full">
            <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
              Invite by email
            </span>
            <input
              type="email"
              className="input"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 w-full md:w-auto">
            <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
              Role
            </span>
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
            Send invite
          </button>
        </form>
      )}

      {error && (
        <div className="text-[12px] mono" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {ok && (
        <div className="text-[12px] mono" style={{ color: "var(--ok)" }}>
          {ok}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
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
              <TeamRow key={m.userId} member={m} canManage={canManage} onChange={refresh} />
            ))}
          </tbody>
        </table>
      </div>

      {pending && (
        <div className="text-[11px] mono" style={{ color: "var(--text-mute)" }}>
          refreshing…
        </div>
      )}
    </>
  );
}
