"use client";

/**
 * Global error boundary for every authenticated segment. If a server component
 * throws (worker cold-start timeout, 502, etc.) we show a specific error
 * card with a "Retry" button rather than a blank page.
 */

import { Icon } from "@/components/Icon";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error("[webfetch/dashboard] render error", error);
    }
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
      <div className="surface p-6 flex flex-col gap-4 max-w-[520px] w-full">
        <div className="flex items-center gap-2">
          <Icon name="info" />
          <h1 className="h2">Something went sideways.</h1>
        </div>
        <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
          The dashboard couldn't reach api.getwebfetch.com just now. This is
          usually a cold-start or a transient 502 — retrying almost always
          works.
        </p>
        {error.digest && (
          <code
            className="mono text-[11px] p-2 rounded-[6px]"
            style={{ background: "var(--bg-elev)", color: "var(--text-mute)" }}
          >
            {error.digest}
          </code>
        )}
        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={() => reset()}>
            Retry
          </button>
          <a className="btn" href="/">
            Back to overview
          </a>
        </div>
      </div>
    </div>
  );
}
