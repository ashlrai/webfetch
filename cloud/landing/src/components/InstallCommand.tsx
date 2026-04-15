"use client";
import { useState } from "react";

const TABS = [
  { id: "npm", label: "npm", cmd: "npm i -g @webfetch/cli" },
  { id: "brew", label: "brew", cmd: "brew install ashlrai/webfetch/webfetch" },
  { id: "curl", label: "curl", cmd: "curl -fsSL https://getwebfetch.com/install.sh | bash" },
  { id: "docker", label: "docker", cmd: "docker run ghcr.io/ashlrai/webfetch:latest" },
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
    <div className="w-full max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--color-border)]">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`px-4 py-2.5 text-[13px] font-mono transition-colors ${
                active === t.id
                  ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)] -mb-px"
                  : "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] border-b-2 border-transparent -mb-px"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="text-xs font-mono text-[var(--color-fg-dim)] hover:text-[var(--color-accent)] px-4 transition-colors"
          aria-label="Copy install command"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="p-4 font-mono text-[13px] text-[var(--color-fg)] overflow-x-auto">
        <span className="text-[var(--color-accent)]">$ </span>
        {current.cmd}
      </pre>
    </div>
  );
}
