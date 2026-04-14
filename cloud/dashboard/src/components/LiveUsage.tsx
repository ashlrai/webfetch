"use client";

import { useEffect, useRef, useState } from "react";

/**
 * SSE consumer for the `/usage/stream` route. Pulses the dot whenever a new
 * usage event arrives. Mirrors the factory dashboard's LiveQueue pattern —
 * polling-file-watch on the server, push events to the client.
 */

interface Tick {
  ts: number;
  endpoint: string;
  status: number;
}

export default function LiveUsage() {
  const [connected, setConnected] = useState(false);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/usage/stream");

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const onTick = (ev: MessageEvent) => {
      try {
        const t = JSON.parse(ev.data) as Tick;
        setTicks((prev) => [t, ...prev].slice(0, 20));
        setFlash(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(false), 900);
      } catch {
        // ignore malformed
      }
    };

    es.addEventListener("tick", onTick as EventListener);
    return () => {
      es.removeEventListener("tick", onTick as EventListener);
      es.close();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const color = connected ? "var(--ok)" : "var(--text-mute)";

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: color,
              boxShadow: flash ? `0 0 10px ${color}` : undefined,
              animation: connected ? "pulse 1.4s ease-in-out infinite" : undefined,
              transition: "box-shadow 200ms ease",
            }}
          />
          <span className="text-sm font-medium">Live usage</span>
        </div>
        <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
          {connected ? "streaming" : "offline"}
        </span>
      </div>
      {ticks.length === 0 ? (
        <div className="text-xs" style={{ color: "var(--text-dim)" }}>
          Waiting for the next fetch…
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {ticks.slice(0, 6).map((t, i) => (
            <li
              key={`${t.ts}-${i}`}
              className="flex items-center justify-between text-[12px] mono"
              style={{ color: i === 0 ? "var(--text)" : "var(--text-dim)" }}
            >
              <span>{t.endpoint}</span>
              <span>
                <span
                  className={`badge ${
                    t.status >= 500 ? "badge-err" : t.status >= 400 ? "badge-warn" : "badge-ok"
                  }`}
                >
                  {t.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
