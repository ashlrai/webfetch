"use client";

import { useState } from "react";
import type { User } from "@shared/types";

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

  const handleProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving("profile");
    setProfileMsg(null);
    try {
      const res = await fetch("/api/proxy/v1/me", {
        method: "PATCH",
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
      const res = await fetch("/api/proxy/v1/me/password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <form className="card p-5 flex flex-col gap-3" onSubmit={handleProfile}>
        <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
          Profile
        </h2>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Name
          </span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Email
          </span>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="flex items-center justify-between">
          <button type="submit" className="btn btn-primary" disabled={saving === "profile"}>
            {saving === "profile" ? "Saving…" : "Save profile"}
          </button>
          {profileMsg && (
            <span className="text-[11px] mono" style={{ color: "var(--text-dim)" }}>
              {profileMsg}
            </span>
          )}
        </div>
      </form>

      <form className="card p-5 flex flex-col gap-3" onSubmit={handlePassword}>
        <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
          Password
        </h2>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Current password
          </span>
          <input type="password" name="current" className="input" required autoComplete="current-password" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            New password
          </span>
          <input type="password" name="next" className="input" required minLength={8} autoComplete="new-password" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Confirm
          </span>
          <input type="password" name="confirm" className="input" required minLength={8} autoComplete="new-password" />
        </label>
        <div className="flex items-center justify-between">
          <button type="submit" className="btn btn-primary" disabled={saving === "password"}>
            {saving === "password" ? "Saving…" : "Update password"}
          </button>
          {passwordMsg && (
            <span className="text-[11px] mono" style={{ color: "var(--text-dim)" }}>
              {passwordMsg}
            </span>
          )}
        </div>
      </form>

      <div className="card p-5 flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
          Two-factor authentication
        </h2>
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          Add a TOTP code from Authy, 1Password, or any authenticator app. Strongly recommended
          for workspace owners and admins.
        </p>
        <div>
          <a href="/api/proxy/v1/me/2fa/setup" className="btn">
            Set up 2FA
          </a>
        </div>
      </div>

      <div className="card p-5 flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
          Email notifications
        </h2>
        {[
          ["quotaWarnings", "Quota warnings (80%, 100%)"],
          ["billingAlerts", "Billing alerts (failed payment, invoice ready)"],
          ["weeklyReport", "Weekly usage report"],
          ["productUpdates", "Product updates and announcements"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notifications[key as keyof typeof notifications]}
              onChange={(e) =>
                setNotifications((prev) => ({
                  ...prev,
                  [key]: e.target.checked,
                }))
              }
            />
            {label}
          </label>
        ))}
        <div className="text-[11px] mono" style={{ color: "var(--text-mute)" }}>
          Saved with your profile.
        </div>
      </div>
    </div>
  );
}
