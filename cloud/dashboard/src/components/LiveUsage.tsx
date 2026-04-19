"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

interface Tick {
  ts: number;
  endpoint: string;
  status: number;
}

type Status = "idle" | "connecting" | "reconnecting" | "live" | "error";

const MAX_RETRIES = 5;
// 5 s is generous for a CF Worker cold start without freezing the UI indefinitely.
const CONNECT_TIMEOUT_MS = 5_000;

export default function LiveUsage() {
  const [status, setStatus] = useState<Status>("idle");
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const attempt = attemptRef.current;
    setStatus(attempt === 0 ? "connecting" : "reconnecting");

    const useFixtures =
      typeof process !== "undefined" && process.env.NEXT_PUBLIC_USE_FIXTURES === "1";
    const streamUrl = useFixtures ? "/usage/stream" : "/api/proxy/v1/usage/stream";

    const es = new EventSource(streamUrl, { withCredentials: true });
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let reconnectId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (reconnectId) clearTimeout(reconnectId);
      es.close();
    };

    const scheduleReconnect = () => {
      if (!mountedRef.current) return;
      cleanup();
      attemptRef.current += 1;
      if (attemptRef.current > MAX_RETRIES) {
        setStatus("error");
        return;
      }
      const delay = Math.min(30_000, 1_000 * 2 ** (attemptRef.current - 1));
      reconnectId = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };

    timeoutId = setTimeout(() => {
      if (!settled && mountedRef.current) scheduleReconnect();
    }, CONNECT_TIMEOUT_MS);

    es.addEventListener("ready", () => {
      if (!mountedRef.current) { es.close(); return; }
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      attemptRef.current = 0;
      setStatus("live");
    });

    es.onerror = () => {
      if (!mountedRef.current) { es.close(); return; }
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      scheduleReconnect();
    };

    const onTick = (ev: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const t = JSON.parse(ev.data) as Tick;
        setTicks((prev) => [t, ...prev].slice(0, 12));
        setFlash(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => {
          if (mountedRef.current) setFlash(false);
        }, 600);
      } catch {
        /* ignore malformed frames */
      }
    };

    es.addEventListener("tick", onTick as EventListener);

    return cleanup;
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    mountedRef.current = true;
    const cleanup = connect();
    return () => {
      mountedRef.current = false;
      cleanup?.();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [connect]);

  const retry = () => {
    attemptRef.current = 0;
    connect();
  };

  const isLive = status === "live";
  const isPending = status === "connecting" || status === "reconnecting";
  const dotColor = isLive ? "var(--ok)" : "var(--text-mute)";

  return (
    <div className="surface p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isPending ? (
            <Icon
              name="cog"
              size={14}
              className="animate-spin"
              style={{ color: "var(--text-mute)" }}
            />
          ) : (
            <span
              className="dot"
              style={{
                color: dotColor,
                animation: isLive ? "pulse 1.6s ease-in-out infinite" : undefined,
                boxShadow: flash ? "0 0 0 4px rgba(63,185,80,0.2)" : undefined,
                transition: "box-shadow 200ms ease",
              }}
            />
          )}
          <span className="h2">Live usage</span>
        </div>
        <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
          {status === "live" && "streaming"}
          {status === "connecting" && "connecting\u2026"}
          {status === "reconnecting" && "reconnecting\u2026"}
          {status === "error" && "unavailable"}
          {status === "idle" && "offline"}
        </span>
      </div>

      {status === "error" ? (
        <div className="flex flex-col gap-3 py-4">
          <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--text-dim)" }}>
            <Icon name="alert" />
            Live updates unavailable — refresh to retry.
          </div>
          <button
            onClick={retry}
            className="self-start text-[12px] mono px-2.5 py-1 rounded border"
            style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}
          >
            Retry
          </button>
        </div>
      ) : isPending && ticks.length === 0 ? (
        <div className="text-[12.5px] flex items-center gap-2 py-6" style={{ color: "var(--text-dim)" }}>
          {status === "reconnecting" ? "Reconnecting\u2026" : "Connecting\u2026"}
        </div>
      ) : ticks.length === 0 ? (
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
