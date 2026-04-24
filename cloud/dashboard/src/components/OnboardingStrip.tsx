"use client";

import { useState } from "react";
import { Icon } from "./Icon";

const CLI_SNIPPET = 'webfetch search "drake portrait" --limit 5';

export default function OnboardingStrip() {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(CLI_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section className="surface p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Icon name="info" style={{ color: "var(--accent)" }} />
        <h2 className="h2">Welcome to webfetch — three steps to go</h2>
      </div>

      <ol className="flex flex-col gap-3">
        {/* Step 1 */}
        <li className="flex items-center gap-3 text-[13px]">
          <span
            className="size-5 rounded-full flex items-center justify-center mono text-[11px] shrink-0"
            style={{ background: "var(--bg-elev)", color: "var(--text)" }}
          >
            1
          </span>
          <span style={{ color: "var(--text-dim)" }}>Create your first API key</span>
          <a href="/keys" className="btn btn-sm btn-primary ml-auto shrink-0">
            Go to /keys →
          </a>
        </li>

        {/* Step 2 */}
        <li className="flex flex-col gap-2 text-[13px]">
          <div className="flex items-center gap-3">
            <span
              className="size-5 rounded-full flex items-center justify-center mono text-[11px] shrink-0"
              style={{ background: "var(--bg-elev)", color: "var(--text)" }}
            >
              2
            </span>
            <span style={{ color: "var(--text-dim)" }}>Run your first search</span>
          </div>
          <div
            className="flex items-center justify-between gap-2 rounded-[6px] px-3 py-2 mono text-[12px] ml-8"
            style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)" }}
          >
            <code style={{ color: "var(--text)" }}>{CLI_SNIPPET}</code>
            <button
              type="button"
              className="btn btn-sm btn-ghost shrink-0"
              onClick={copy}
              aria-label="Copy command"
            >
              {copied ? <Icon name="check" size={13} /> : <Icon name="download" size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </li>

        {/* Step 3 */}
        <li className="flex items-center gap-3 text-[13px]">
          <span
            className="size-5 rounded-full flex items-center justify-center mono text-[11px] shrink-0"
            style={{ background: "var(--bg-elev)", color: "var(--text)" }}
          >
            3
          </span>
          <span style={{ color: "var(--text-dim)" }}>Read the docs</span>
          <a
            href="https://getwebfetch.com/docs"
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-sm ml-auto shrink-0"
          >
            getwebfetch.com/docs →
          </a>
        </li>
      </ol>
    </section>
  );
}
