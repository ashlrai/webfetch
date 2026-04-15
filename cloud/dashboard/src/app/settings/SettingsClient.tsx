"use client";

import { Icon } from "@/components/Icon";
import Modal from "@/components/Modal";
import type { User } from "@shared/types";
import { useState } from "react";

export default function SettingsClient({ user }: { user: User }) {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email);
  const [notifications, setNotifications] = useState({
    quotaWarnings: true,
    weeklyReport: true,
    productUpdates: false,
    billingAlerts: true,
  });
  const [saving, setSaving] = useState<"profile" | "password" | null>(null);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [twoFaOpen, setTwoFaOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);

  const handleProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving("profile");
    setProfileMsg(null);
    try {
      const res = await fetch("/api/proxy/auth/update-user", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, notifications }),
      });
      if (!res.ok && res.status !== 404) throw new Error(await res.text());
      setProfileMsg("Saved.");
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const current = form.get("current") as string;
    const next = form.get("next") as string;
    const confirm = form.get("confirm") as string;
    if (next !== confirm) {
      setPasswordMsg("Passwords do not match.");
      return;
    }
    setSaving("password");
    setPasswordMsg(null);
    try {
      const res = await fetch("/api/proxy/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok && res.status !== 404) throw new Error(await res.text());
      setPasswordMsg("Password updated.");
      (e.currentTarget as HTMLFormElement).reset();
    } catch (err) {
      setPasswordMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(null);
    }
  };

  const sessions = [
    { id: "s1", device: "macOS · Safari", ip: "73.12.xx.xx", ts: "active now", current: true },
    { id: "s2", device: "iOS · webfetch-cli", ip: "10.0.xx.xx", ts: "2h ago", current: false },
    { id: "s3", device: "Linux · Chrome", ip: "34.89.xx.xx", ts: "3d ago", current: false },
  ];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form className="surface p-5 flex flex-col gap-3" onSubmit={handleProfile}>
          <h2 className="h2">Profile</h2>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Email</span>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div className="flex items-center justify-between mt-1">
            <button type="submit" className="btn btn-primary" disabled={saving === "profile"}>
              {saving === "profile" ? "Saving…" : "Save profile"}
            </button>
            {profileMsg && (
              <span
                className="text-[11.5px] mono flex items-center gap-1"
                style={{ color: profileMsg === "Saved." ? "var(--ok)" : "var(--danger)" }}
              >
                {profileMsg === "Saved." && <Icon name="check" size={11} />}
                {profileMsg}
              </span>
            )}
          </div>
        </form>

        <form className="surface p-5 flex flex-col gap-3" onSubmit={handlePassword}>
          <h2 className="h2">Password</h2>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Current password</span>
            <input
              type="password"
              name="current"
              className="input"
              required
              autoComplete="current-password"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">New password</span>
            <input
              type="password"
              name="next"
              className="input"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Confirm</span>
            <input
              type="password"
              name="confirm"
              className="input"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <div className="flex items-center justify-between mt-1">
            <button type="submit" className="btn btn-primary" disabled={saving === "password"}>
              {saving === "password" ? "Saving…" : "Update password"}
            </button>
            {passwordMsg && (
              <span
                className="text-[11.5px] mono"
                style={{
                  color:
                    passwordMsg.includes("match") || passwordMsg.includes("fail")
                      ? "var(--danger)"
                      : "var(--ok)",
                }}
              >
                {passwordMsg}
              </span>
            )}
          </div>
        </form>

        <div id="2fa" className="surface p-5 flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <h2 className="h2">Two-factor authentication</h2>
            <span className="badge badge-warn">not enabled</span>
          </div>
          <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
            Add a TOTP code from Authy, 1Password, or any authenticator app. Strongly recommended
            for workspace owners and admins.
          </p>
          <div>
            <button className="btn" onClick={() => setTwoFaOpen(true)}>
              <Icon name="shield" /> Set up 2FA
            </button>
          </div>
        </div>

        <div className="surface p-5 flex flex-col gap-3">
          <h2 className="h2">Email notifications</h2>
          {[
            ["quotaWarnings", "Quota warnings (80%, 100%)"],
            ["billingAlerts", "Billing alerts (failed payment, invoice ready)"],
            ["weeklyReport", "Weekly usage report"],
            ["productUpdates", "Product updates and announcements"],
          ].map(([key, label]) => (
            <label
              key={key}
              className="flex items-center justify-between gap-2 text-[13px] cursor-pointer"
            >
              <span>{label}</span>
              <input
                type="checkbox"
                checked={notifications[key as keyof typeof notifications]}
                onChange={(e) => setNotifications((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
            </label>
          ))}
          <div className="text-[11px] mono" style={{ color: "var(--text-mute)" }}>
            Saved with your profile.
          </div>
        </div>
      </div>

      {/* Sessions */}
      <div className="surface p-0 overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="h2">Active sessions</h2>
          <button className="btn btn-sm btn-danger">
            <Icon name="out" /> Sign out all others
          </button>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Device</th>
              <th>IP</th>
              <th>Last active</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <span>{s.device}</span>
                    {s.current && <span className="badge badge-ok">this session</span>}
                  </div>
                </td>
                <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
                  {s.ip}
                </td>
                <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
                  {s.ts}
                </td>
                <td style={{ textAlign: "right" }}>
                  {!s.current && <button className="btn btn-sm btn-danger">Revoke</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Danger zone */}
      <div
        className="surface p-5 flex flex-col gap-3"
        style={{ borderColor: "rgba(248,81,73,0.28)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="h2" style={{ color: "var(--danger)" }}>
              Danger zone
            </h2>
            <p className="text-[13px] mt-1" style={{ color: "var(--text-dim)" }}>
              Deleting your account revokes every key, cancels your subscription at the end of the
              period, and purges usage logs after 90 days.
            </p>
          </div>
          <button className="btn btn-danger" onClick={() => setDangerOpen(true)}>
            <Icon name="trash" /> Delete account
          </button>
        </div>
      </div>

      {twoFaOpen && (
        <Modal
          title="Set up 2FA"
          subtitle="Scan the QR in your authenticator, then enter the 6-digit code."
          onClose={() => setTwoFaOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setTwoFaOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary">Verify and enable</button>
            </>
          }
        >
          <div className="flex gap-5">
            <div
              className="size-[144px] shrink-0 rounded-[8px] flex items-center justify-center"
              style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)" }}
            >
              <svg viewBox="0 0 120 120" className="size-[120px]">
                {/* stylized QR placeholder */}
                {Array.from({ length: 100 }).map((_, i) => {
                  const x = (i % 10) * 12;
                  const y = Math.floor(i / 10) * 12;
                  const on = (i * 13) % 3 === 0;
                  return on ? (
                    <rect key={i} x={x} y={y} width={10} height={10} fill="var(--text)" />
                  ) : null;
                })}
              </svg>
            </div>
            <div className="flex flex-col gap-2 flex-1">
              <label className="flex flex-col gap-1.5">
                <span className="eyebrow">Manual code</span>
                <input className="input mono" readOnly value="JBSWY3DPEHPK3PXP" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="eyebrow">6-digit code</span>
                <input className="input mono" placeholder="000000" maxLength={6} />
              </label>
            </div>
          </div>
          <div className="mt-4 eyebrow">Recovery codes</div>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--text-dim)" }}>
            Save these somewhere safe — each code works once if you lose your device.
          </p>
          <div
            className="grid grid-cols-2 gap-1.5 mt-2 p-3 rounded-[8px] mono text-[12.5px]"
            style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)" }}
          >
            {["ATKW-99LP", "B4XR-QQ2K", "Z3EE-MN7T", "YP61-DD0X", "RC4H-XX1L", "U802-WW9E"].map(
              (c) => (
                <span key={c}>{c}</span>
              ),
            )}
          </div>
        </Modal>
      )}

      {dangerOpen && (
        <Modal
          title="Delete account?"
          subtitle="This action is irreversible. Type DELETE to confirm."
          onClose={() => setDangerOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setDangerOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-danger">Delete account</button>
            </>
          }
        >
          <input className="input mono" placeholder="DELETE" />
        </Modal>
      )}
    </>
  );
}
