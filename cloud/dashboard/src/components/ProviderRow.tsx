"use client";

import { saveProviderKey, testProvider } from "@/lib/api";
import type { ProviderStatus } from "@/lib/fixtures";
import { formatRelative } from "@/lib/format";
import { useState } from "react";
import { Icon } from "./Icon";
import Modal from "./Modal";

/**
 * Renamed conceptually to ProviderCard — keeps file name to not break imports.
 * Dense 3-col grid card with BYOK modal, auth status pill, license-default tag,
 * and inline Test button.
 */

const LICENSE_DEFAULT = new Set([
  "unsplash",
  "pexels",
  "pixabay",
  "wikimedia",
  "openverse",
  "flickr",
  "smithsonian",
  "metmuseum",
  "europeana",
  "nasa",
]);

export default function ProviderRow({ provider }: { provider: ProviderStatus }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [savedState, setSavedState] = useState(provider);

  const modeLabel =
    savedState.mode === "byok" ? "your key" : savedState.mode === "pool" ? "pool" : "missing";
  const modeBadge =
    savedState.mode === "byok"
      ? "badge-ok"
      : savedState.mode === "pool"
        ? "badge-info"
        : "badge-warn";

  const licenseDefault = LICENSE_DEFAULT.has(savedState.name);

  const handleSave = async () => {
    if (!value.trim()) return;
    setBusy("save");
    setResult(null);
    try {
      await saveProviderKey(savedState.name, value.trim());
      setResult({ ok: true, msg: "Saved. Key is encrypted at rest." });
      setSavedState({ ...savedState, mode: "byok", hasKey: true });
      setValue("");
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy("test");
    setResult(null);
    try {
      const r = await testProvider(savedState.name);
      setResult({ ok: r.ok, msg: r.message });
      if (r.ok) {
        setSavedState({ ...savedState, lastTestOk: true, lastTestAt: Date.now() });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="surface p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="font-medium text-[13.5px]">{savedState.name}</div>
            <a
              href={savedState.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[11px] mono flex items-center gap-1 hover:underline"
              style={{ color: "var(--text-mute)" }}
            >
              docs <Icon name="external" size={10} />
            </a>
          </div>
          <span className={`badge ${modeBadge}`}>{modeLabel}</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {licenseDefault && <span className="badge badge-accent">license-default</span>}
          {savedState.lastTestAt ? (
            <span className={`badge ${savedState.lastTestOk ? "badge-ok" : "badge-err"}`}>
              <Icon name={savedState.lastTestOk ? "check" : "x"} size={10} />
              {savedState.lastTestOk ? "tested" : "test failed"}{" "}
              {formatRelative(savedState.lastTestAt)}
            </span>
          ) : (
            <span className="badge">untested</span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-auto">
          <button className="btn btn-sm flex-1" onClick={() => setOpen(true)}>
            {savedState.hasKey ? "Replace key" : "Add key"}
          </button>
          <button className="btn btn-sm" onClick={handleTest} disabled={busy !== null}>
            {busy === "test" ? "Testing" : "Test"}
          </button>
        </div>
      </div>

      {open && (
        <Modal
          title={`${savedState.name} — bring your own key`}
          subtitle="Keys are AES-256 encrypted and only decrypted inside the Worker runtime."
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={busy !== null || !value.trim()}
              >
                {busy === "save" ? "Saving…" : "Save key"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">API key</span>
              <input
                type="password"
                className="input mono"
                placeholder="Paste your API key"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            {result && (
              <div
                className="text-[12.5px] mono flex items-center gap-2"
                style={{ color: result.ok ? "var(--ok)" : "var(--danger)" }}
              >
                <Icon name={result.ok ? "check" : "alert"} />
                {result.msg}
              </div>
            )}
            <div className="rule" />
            <p className="text-[12px]" style={{ color: "var(--text-dim)" }}>
              Your key replaces webfetch's pooled quota for this provider. Delete anytime — we
              rotate back to pool (or missing) automatically.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
