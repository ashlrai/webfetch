"use client";
import { useState } from "react";

const TABS = [
  { id: "npm", label: "npm", cmd: "npm i -g @webfetch/cli" },
  { id: "brew", label: "brew", cmd: "brew install ashlr-ai/webfetch/webfetch" },
  { id: "curl", label: "curl", cmd: "curl -fsSL https://webfetch.dev/install.sh | bash" },
  { id: "docker", label: "docker", cmd: "docker run ghcr.io/ashlr-ai/webfetch:latest" },
];

export function InstallCommand() {
  const [active, setActive] = useState("npm");
  const [copied, setCopied] = useState(false);
  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current.cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="w-full max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)]">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`px-4 py-2.5 text-sm font-mono transition-colors ${
                active === t.id
                  ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                  : "text-[var(--fg-dim)] hover:text-[var(--fg)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="text-xs text-[var(--fg-dim)] hover:text-[var(--accent)] px-4"
          aria-label="Copy install command"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="p-4 font-mono text-sm text-[var(--fg)] overflow-x-auto">
        <span className="text-[var(--accent)]">$ </span>
        {current.cmd}
      </pre>
    </div>
  );
}
