"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

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
    let es: EventSource | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const open = () => {
      // In prod, stream from api.getwebfetch.com via the proxy so the SSE
      // connection carries the session cookie. In fixtures-only dev we fall
      // back to the local synthetic stream at /usage/stream.
      const useFixtures =
        typeof process !== "undefined" && process.env.NEXT_PUBLIC_USE_FIXTURES === "1";
      const streamUrl = useFixtures ? "/usage/stream" : "/api/proxy/v1/usage/stream";
      es = new EventSource(streamUrl, { withCredentials: true });
      // Mark as offline if first byte hasn't arrived in 4s; UI surfaces "reconnecting" instead of a stuck spinner.
      connectTimer = setTimeout(() => setConnected(false), 4000);

      es.onopen = () => {
        if (connectTimer) clearTimeout(connectTimer);
        attempt = 0;
        setConnected(true);
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        // Exponential backoff: 1s, 2s, 4s, capped 30s.
        const delay = Math.min(30_000, 1000 * 2 ** attempt++);
        reconnectTimer = setTimeout(open, delay);
      };
      const onTick = (ev: MessageEvent) => {
        try {
          const t = JSON.parse(ev.data) as Tick;
          setTicks((prev) => [t, ...prev].slice(0, 12));
          setFlash(true);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlash(false), 600);
        } catch {
          /* ignore */
        }
      };
      es.addEventListener("tick", onTick as EventListener);
    };

    open();
    return () => {
      if (connectTimer) clearTimeout(connectTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const color = connected ? "var(--ok)" : "var(--text-mute)";

  return (
    <div className="surface p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="dot"
            style={{
              color,
              animation: connected ? "pulse 1.6s ease-in-out infinite" : undefined,
              boxShadow: flash ? "0 0 0 4px rgba(63,185,80,0.2)" : undefined,
              transition: "box-shadow 200ms ease",
            }}
          />
          <span className="h2">Live usage</span>
        </div>
        <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
          {connected ? "streaming" : "offline"}
        </span>
      </div>
      {ticks.length === 0 ? (
        <div
          className="text-[12.5px] flex items-center gap-2 py-6"
          style={{ color: "var(--text-dim)" }}
        >
          <Icon name="clock" />
          Waiting for the next fetch.
        </div>
      ) : (
        <ul className="flex flex-col">
          {ticks.slice(0, 7).map((t, i) => (
            <li
              key={`${t.ts}-${i}`}
              className="flex items-center justify-between py-1.5 text-[12.5px] mono border-b last:border-0"
              style={{
                borderColor: "var(--border)",
                color: i === 0 ? "var(--text)" : "var(--text-dim)",
                opacity: 1 - i * 0.06,
              }}
            >
              <span className="truncate">{t.endpoint}</span>
              <span
                className={`badge ${t.status >= 500 ? "badge-err" : t.status >= 400 ? "badge-warn" : "badge-ok"}`}
              >
                {t.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
