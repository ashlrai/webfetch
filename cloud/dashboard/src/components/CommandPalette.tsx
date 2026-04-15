"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  section: "Go to" | "Actions" | "Workspaces";
  icon: IconName;
  href: string;
}

const BASE: Cmd[] = [
  { id: "go-overview", label: "Overview", section: "Go to", icon: "grid", href: "/" },
  { id: "go-keys", label: "API keys", section: "Go to", icon: "key", href: "/keys" },
  { id: "go-usage", label: "Usage", section: "Go to", icon: "bar", href: "/usage" },
  { id: "go-providers", label: "Providers", section: "Go to", icon: "plug", href: "/providers" },
  { id: "go-team", label: "Team", section: "Go to", icon: "users", href: "/team" },
  { id: "go-billing", label: "Billing", section: "Go to", icon: "card", href: "/billing" },
  { id: "go-audit", label: "Audit log", section: "Go to", icon: "shield", href: "/audit" },
  { id: "go-settings", label: "Settings", section: "Go to", icon: "cog", href: "/settings" },
  {
    id: "act-key-new",
    label: "Create API key",
    hint: "Open the new-key modal",
    section: "Actions",
    icon: "plus",
    href: "/keys?new=1",
  },
  {
    id: "act-invite",
    label: "Invite teammate",
    section: "Actions",
    icon: "users",
    href: "/team?new=1",
  },
  {
    id: "act-upgrade",
    label: "Upgrade plan",
    section: "Actions",
    icon: "arrow-up",
    href: "/billing",
  },
  { id: "act-2fa", label: "Set up 2FA", section: "Actions", icon: "shield", href: "/settings#2fa" },
];

export default function CommandPalette({
  workspaces,
  onClose,
  onNavigate,
}: {
  workspaces: { id: string; slug: string; name: string }[];
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Cmd[]>(() => {
    const ws: Cmd[] = workspaces.map((w) => ({
      id: `ws-${w.id}`,
      label: `Switch to ${w.name}`,
      hint: w.slug,
      section: "Workspaces",
      icon: "users" as IconName,
      href: `/?ws=${w.slug}`,
    }));
    const all = [...BASE, ...ws];
    if (!q.trim()) return all;
    const needle = q.toLowerCase();
    return all.filter(
      (c) => c.label.toLowerCase().includes(needle) || c.hint?.toLowerCase().includes(needle),
    );
  }, [q, workspaces]);

  useEffect(() => {
    inputRef.current?.focus();
    // trap focus minimally
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [q]);

  const grouped = useMemo(() => {
    const map = new Map<Cmd["section"], Cmd[]>();
    for (const c of items) {
      const arr = map.get(c.section) ?? [];
      arr.push(c);
      map.set(c.section, arr);
    }
    return Array.from(map.entries());
  }, [items]);

  const flat = items;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % Math.max(1, flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + flat.length) % Math.max(1, flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flat[cursor];
      if (pick) onNavigate(pick.href);
    }
  };

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      style={{ alignItems: "flex-start", paddingTop: "12vh" }}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="cmdk">
        <div className="flex items-center px-4 border-b" style={{ borderColor: "var(--border)" }}>
          <Icon name="search" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search routes, actions, workspaces…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Command input"
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="cmdk-list">
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px]" style={{ color: "var(--text-dim)" }}>
              Nothing matches "{q}".
            </div>
          ) : (
            grouped.map(([section, entries]) => (
              <div key={section}>
                <div className="cmdk-section">{section}</div>
                {entries.map((c) => {
                  const i = flat.indexOf(c);
                  const active = i === cursor;
                  return (
                    <div
                      key={c.id}
                      className="cmdk-item"
                      data-active={active}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => onNavigate(c.href)}
                    >
                      <div className="flex items-center gap-3">
                        <Icon name={c.icon} />
                        <span>{c.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.hint && (
                          <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
                            {c.hint}
                          </span>
                        )}
                        {active && <span className="kbd">↵</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div
          className="px-4 py-2 border-t flex items-center gap-3 text-[11px]"
          style={{ borderColor: "var(--border)", color: "var(--text-mute)" }}
        >
          <span>
            <span className="kbd">↑</span>
            <span className="kbd ml-1">↓</span> navigate
          </span>
          <span>
            <span className="kbd">↵</span> open
          </span>
          <span>
            <span className="kbd">ESC</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
