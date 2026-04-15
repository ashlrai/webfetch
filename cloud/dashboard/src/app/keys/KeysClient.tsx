"use client";

import EmptyState from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import KeyRow from "@/components/KeyRow";
import Modal from "@/components/Modal";
import { createKey, listKeys } from "@/lib/api";
import type { ApiKey } from "@shared/types";
import { useMemo, useState, useTransition } from "react";

type SortKey = "name" | "createdAt" | "lastUsedAt";
type SortDir = "asc" | "desc";

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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "createdAt",
    dir: "desc",
  });

  const refresh = () =>
    startTransition(async () => {
      const next = await listKeys();
      setKeys(next);
    });

  const sorted = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = keys.filter(
      (k) => !q || k.name.toLowerCase().includes(q) || k.prefix.toLowerCase().includes(q),
    );
    filtered.sort((a, b) => {
      const av = a[sort.key] ?? 0;
      const bv = b[sort.key] ?? 0;
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return filtered;
  }, [keys, query, sort]);

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
      /* noop */
    }
  };

  const closeReveal = () => {
    setReveal(null);
    setShowModal(false);
    setSaved(false);
  };

  const active = keys.filter((k) => k.revokedAt == null);
  const revoked = keys.filter((k) => k.revokedAt != null);

  const toggleSort = (key: SortKey) => {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  };
  const sortArrow = (key: SortKey) =>
    sort.key !== key ? null : (
      <Icon name={sort.dir === "asc" ? "arrow-up" : "arrow-down"} size={10} />
    );

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="badge badge-ok">
            <span className="dot" />
            {active.length} active
          </span>
          {revoked.length > 0 && <span className="badge">{revoked.length} revoked</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Icon
              name="search"
              className="absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-mute)" }}
            />
            <input
              className="input"
              style={{ paddingLeft: 28, width: 220 }}
              placeholder="Filter keys…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Icon name="plus" /> New API key
          </button>
        </div>
      </div>

      {keys.length === 0 ? (
        <EmptyState
          title="No API keys yet."
          description="Create your first key to call api.getwebfetch.com from the CLI, MCP server, or your own code."
          action={
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Icon name="plus" /> Create your first key
            </button>
          }
        />
      ) : (
        <div className="surface overflow-hidden">
          <table className="data">
            <thead>
              <tr>
                <th>
                  <span className="sort" onClick={() => toggleSort("name")}>
                    Name {sortArrow("name")}
                  </span>
                </th>
                <th>Key</th>
                <th>
                  <span className="sort" onClick={() => toggleSort("createdAt")}>
                    Created {sortArrow("createdAt")}
                  </span>
                </th>
                <th>
                  <span className="sort" onClick={() => toggleSort("lastUsedAt")}>
                    Last used {sortArrow("lastUsedAt")}
                  </span>
                </th>
                <th>Scope</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((k) => (
                <KeyRow key={k.id} apiKey={k} onChange={refresh} />
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{ textAlign: "center", color: "var(--text-dim)", padding: 32 }}
                  >
                    No keys match "{query}".
                  </td>
                </tr>
              )}
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
        <Modal
          title="New API key"
          subtitle='Give the key a name you will recognize later (e.g. "prod-edge", "laptop-dev").'
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={(e) => handleCreate(e as unknown as React.FormEvent)}
              >
                Create key
              </button>
            </>
          }
        >
          <form className="flex flex-col gap-3" onSubmit={handleCreate}>
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="prod-edge"
                maxLength={60}
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Scope</span>
              <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="workspace">workspace — full access</option>
                <option value="read">read — search + probe only</option>
                <option value="download">download — fetch binary content</option>
              </select>
            </label>
            {error && (
              <div className="text-[12px] mono" style={{ color: "var(--danger)" }}>
                {error}
              </div>
            )}
          </form>
        </Modal>
      )}

      {reveal && (
        <Modal
          title="Save your key now"
          subtitle="This is the only time we'll show the full secret. Store it somewhere safe (1Password, a vault, your .env)."
          onClose={() => {
            if (saved) closeReveal();
          }}
          footer={
            <button className="btn btn-primary" disabled={!saved} onClick={closeReveal}>
              Done
            </button>
          }
        >
          <div className="flex flex-col gap-3">
            <div
              className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-[8px]"
              style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)" }}
            >
              <code className="mono text-[12.5px] break-all">{reveal.raw}</code>
              <button type="button" className="btn btn-sm" onClick={handleCopy}>
                <Icon name={copied ? "check" : "copy"} />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <label
              className="flex items-center gap-2 text-[12.5px] cursor-pointer"
              style={{ color: "var(--text-dim)" }}
            >
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              I've saved this key somewhere safe.
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
