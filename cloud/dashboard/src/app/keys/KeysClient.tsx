"use client";

import { useState, useTransition } from "react";
import type { ApiKey } from "@shared/types";
import KeyRow from "@/components/KeyRow";
import { createKey, listKeys } from "@/lib/api";

export default function KeysClient({ initial }: { initial: ApiKey[] }) {
  const [keys, setKeys] = useState<ApiKey[]>(initial);
  const [showModal, setShowModal] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("workspace");
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ key: ApiKey; raw: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const refresh = () => {
    startTransition(async () => {
      const next = await listKeys();
      setKeys(next);
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const { key, raw } = await createKey(name.trim(), scope);
      setReveal({ key, raw });
      setKeys((prev) => [key, ...prev]);
      setName("");
      setScope("workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    }
  };

  const handleCopy = async () => {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; user can select + copy manually
    }
  };

  const closeReveal = () => {
    setReveal(null);
    setShowModal(false);
    setSaved(false);
  };

  const active = keys.filter((k) => k.revokedAt == null);
  const revoked = keys.filter((k) => k.revokedAt != null);

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
          {active.length} active · {revoked.length} revoked
        </span>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          Create API key
        </button>
      </div>

      {keys.length === 0 ? (
        <div className="card p-10 text-center flex flex-col gap-3 items-center">
          <div className="text-sm font-medium">No API keys yet.</div>
          <p className="text-xs max-w-sm" style={{ color: "var(--text-dim)" }}>
            Create your first key to start calling{" "}
            <span className="mono">api.webfetch.dev</span> from the CLI, MCP server, or your own
            code.
          </p>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            Create your first key
          </button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Scope</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <KeyRow key={k.id} apiKey={k} onChange={refresh} />
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

      {showModal && !reveal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <form className="modal flex flex-col gap-4" onClick={(e) => e.stopPropagation()} onSubmit={handleCreate}>
            <div>
              <h2 className="text-lg font-medium">New API key</h2>
              <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                Give the key a name so you can recognize it later (e.g. "prod-edge", "laptop-dev").
              </p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
                Name
              </span>
              <input
                autoFocus
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="prod-edge"
                maxLength={60}
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
                Scope
              </span>
              <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="workspace">workspace — full access to this workspace</option>
                <option value="read">read — search + probe only</option>
                <option value="download">download — fetch binary content</option>
              </select>
            </label>
            {error && (
              <div className="text-[12px] mono" style={{ color: "var(--danger)" }}>
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Create key
              </button>
            </div>
          </form>
        </div>
      )}

      {reveal && (
        <div className="modal-backdrop">
          <div className="modal flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-medium">Save your key now</h2>
              <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                This is the only time we'll show the full secret. Store it somewhere safe
                (1Password, a vault, your <span className="mono">.env</span>).
              </p>
            </div>
            <div
              className="card p-3 flex items-center justify-between gap-2"
              style={{ background: "var(--bg-elev)" }}
            >
              <code className="mono text-sm break-all">{reveal.raw}</code>
              <button type="button" className="btn" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
              <input
                type="checkbox"
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
              />
              I've saved this key somewhere safe.
            </label>
            <div className="flex items-center justify-end gap-2">
              <button className="btn btn-primary" disabled={!saved} onClick={closeReveal}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
