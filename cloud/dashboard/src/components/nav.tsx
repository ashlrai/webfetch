"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Overview" },
  { href: "/keys", label: "Keys" },
  { href: "/usage", label: "Usage" },
  { href: "/team", label: "Team" },
  { href: "/billing", label: "Billing" },
  { href: "/providers", label: "Providers" },
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" },
];

interface Props {
  workspaces: { id: string; slug: string; name: string }[];
  activeSlug: string;
  authed: boolean;
}

export default function Nav({ workspaces, activeSlug, authed }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isAuthRoute = pathname === "/login" || pathname === "/signup";
  if (isAuthRoute) {
    return (
      <header
        className="sticky top-0 z-30 backdrop-blur-xl"
        style={{ background: "rgba(11,13,18,0.72)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="mx-auto max-w-[1400px] px-6 h-14 flex items-center">
          <Logo />
        </div>
      </header>
    );
  }

  const active = workspaces.find((w) => w.slug === activeSlug) ?? workspaces[0];

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-xl"
      style={{ background: "rgba(11,13,18,0.72)", borderBottom: "1px solid var(--border)" }}
    >
      <div className="mx-auto max-w-[1400px] px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <Logo />
          {authed && workspaces.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 px-3 h-8 rounded-lg text-sm"
                style={{ background: "var(--bg-elev)", border: "1px solid var(--border)" }}
              >
                <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>ws</span>
                <span className="truncate max-w-[140px]">{active?.name ?? "—"}</span>
                <span style={{ color: "var(--text-mute)" }}>⌄</span>
              </button>
              {open && (
                <div
                  className="absolute left-0 top-10 min-w-[200px] rounded-xl p-1 z-40"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)" }}
                >
                  {workspaces.map((w) => (
                    <Link
                      key={w.id}
                      href={`/?ws=${w.slug}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between px-3 py-2 rounded-lg text-sm hover:bg-white/5"
                    >
                      <span>{w.name}</span>
                      <span className="mono text-[10px]" style={{ color: "var(--text-mute)" }}>{w.slug}</span>
                    </Link>
                  ))}
                  <div style={{ borderTop: "1px solid var(--border)" }} className="my-1" />
                  <Link
                    href="/team?new=1"
                    onClick={() => setOpen(false)}
                    className="flex items-center px-3 py-2 rounded-lg text-sm hover:bg-white/5"
                    style={{ color: "var(--text-dim)" }}
                  >
                    + New workspace
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="hidden md:flex items-center gap-1">
          {authed &&
            LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="nav-link"
                data-active={pathname === l.href}
              >
                {l.label}
              </Link>
            ))}
        </nav>

        <div className="flex items-center gap-2">
          {authed ? (
            <span className="kbd">{active?.slug ?? "—"}</span>
          ) : (
            <>
              <Link href="/login" className="nav-link">Sign in</Link>
              <Link href="/signup" className="btn btn-primary">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-3 shrink-0">
      <div
        className="size-6 rounded-[6px]"
        style={{ background: "linear-gradient(135deg, var(--accent), #ffb088)" }}
      />
      <div className="flex items-baseline gap-2">
        <span className="font-medium tracking-tight">webfetch</span>
        <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>/cloud</span>
      </div>
    </Link>
  );
}
