"use client";

import { useState } from "react";
import { saveProviderKey, testProvider } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { ProviderStatus } from "@/lib/fixtures";

export default function ProviderRow({ provider }: { provider: ProviderStatus }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const modeBadge =
    provider.mode === "byok"
      ? "badge-ok"
      : provider.mode === "pool"
        ? "badge-info"
        : "badge-warn";
  const modeLabel =
    provider.mode === "byok"
      ? "using your key"
      : provider.mode === "pool"
        ? "using pool"
        : "missing key";

  const handleSave = async () => {
    if (!value.trim()) return;
    setBusy("save");
    setResult(null);
    try {
      await saveProviderKey(provider.name, value.trim());
      setResult({ ok: true, msg: "Saved. Key is encrypted at rest." });
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
      const r = await testProvider(provider.name);
      setResult({ ok: r.ok, msg: r.message });
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium mono text-sm">{provider.name}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`badge ${modeBadge}`}>{modeLabel}</span>
            {provider.lastTestAt && (
              <span
                className={`badge ${provider.lastTestOk ? "badge-ok" : "badge-err"}`}
              >
                tested {formatRelative(provider.lastTestAt)}
              </span>
            )}
          </div>
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[11px] mono hover:underline"
          style={{ color: "var(--text-dim)" }}
        >
          docs ↗
        </a>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="password"
          placeholder={provider.hasKey ? "Replace key…" : "Paste API key"}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`${provider.name} API key`}
        />
        <button
          className="btn"
          onClick={handleSave}
          disabled={busy !== null || !value.trim()}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          className="btn"
          onClick={handleTest}
          disabled={busy !== null || (!provider.hasKey && !value.trim())}
        >
          {busy === "test" ? "Testing…" : "Test"}
        </button>
      </div>

      {result && (
        <div
          className="text-[12px] mono"
          style={{ color: result.ok ? "var(--ok)" : "var(--danger)" }}
        >
          {result.msg}
        </div>
      )}
    </div>
  );
}
