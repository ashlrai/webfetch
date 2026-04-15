"use client";
import { useState } from "react";

export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button
      onClick={onClick}
      aria-label="Copy to clipboard"
      className={`text-xs font-mono text-[var(--color-fg-dim)] hover:text-[var(--color-accent)] transition-colors px-3 py-1 border border-[var(--color-border)] rounded hover:border-[var(--color-accent)] ${className}`}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
