"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CommandPalette from "./CommandPalette";
import { Icon } from "./Icon";

interface Workspace {
  id: string;
  slug: string;
  name: string;
  plan?: string;
}

const LINKS: { href: string; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { href: "/", label: "Overview", icon: "grid" },
  { href: "/keys", label: "API keys", icon: "key" },
  { href: "/usage", label: "Usage", icon: "bar" },
  { href: "/providers", label: "Providers", icon: "plug" },
  { href: "/team", label: "Team", icon: "users" },
  { href: "/billing", label: "Billing", icon: "card" },
  { href: "/audit", label: "Audit", icon: "shield" },
  { href: "/settings", label: "Settings", icon: "cog" },
];

export default function Shell({
  workspaces,
  activeSlug,
  authed,
  userLabel,
  userEmail,
  children,
}: {
  workspaces: Workspace[];
  activeSlug: string;
  authed: boolean;
  userLabel: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthRoute = pathname === "/login" || pathname === "/signup";

  const [sideOpen, setSideOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  // Global Cmd-K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setCmdkOpen(false);
        setMenuOpen(false);
        setWsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (isAuthRoute) {
    return (
      <>
        <header className="topbar">
          <Link href="/" className="flex items-center gap-2 px-2">
            <Logo />
          </Link>
        </header>
        <main className="mx-auto max-w-[520px] px-6 py-10">{children}</main>
      </>
    );
  }

  if (!authed) {
    return (
      <>
        <header className="topbar">
          <Logo />
          <div className="flex items-center gap-2">
            <Link href="/login" className="nav-link">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-primary">
              Sign up
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-[1200px] px-6 py-10">{children}</main>
      </>
    );
  }

  const active = workspaces.find((w) => w.slug === activeSlug) ?? workspaces[0];

  return (
    <>
      <aside className="side" data-open={sideOpen}>
        <div
          className="h-[48px] px-4 flex items-center border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <Logo />
        </div>

        {/* Workspace switcher */}
        <div className="px-2 pt-3 pb-2 relative">
          <button
            onClick={() => setWsOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-2 h-9 rounded-[8px] text-left transition-colors"
            style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)" }}
            aria-label="Switch workspace"
          >
            <div
              className="size-5 rounded-[5px] shrink-0 flex items-center justify-center text-[10px] font-medium"
              style={{ background: "var(--accent)", color: "#1a0a04" }}
            >
              {active?.name?.[0]?.toUpperCase() ?? "W"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] truncate">{active?.name ?? "No workspace"}</div>
              <div className="mono text-[10px]" style={{ color: "var(--text-mute)" }}>
                {active?.plan ?? "—"}
              </div>
            </div>
            <Icon name="chevron" className="shrink-0" />
          </button>
          {wsOpen && (
            <div
              className="absolute left-2 right-2 top-full mt-1 rounded-[8px] p-1 z-40"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)" }}
            >
              {workspaces.map((w) => (
                <Link
                  key={w.id}
                  href={`/?ws=${w.slug}`}
                  onClick={() => setWsOpen(false)}
                  className="flex items-center justify-between px-2 h-8 rounded-[6px] text-[13px] hover:bg-white/5"
                >
                  <span className="truncate">{w.name}</span>
                  <span className="mono text-[10px]" style={{ color: "var(--text-mute)" }}>
                    {w.plan}
                  </span>
                </Link>
              ))}
              <div className="rule my-1" />
              <Link
                href="/team?new=1"
                onClick={() => setWsOpen(false)}
                className="flex items-center gap-2 px-2 h-8 rounded-[6px] text-[13px] hover:bg-white/5"
                style={{ color: "var(--text-dim)" }}
              >
                <Icon name="plus" /> New workspace
              </Link>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {LINKS.map((l) => {
            const isActive = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className="side-item"
                data-active={isActive}
                onClick={() => setSideOpen(false)}
              >
                <Icon name={l.icon} className="ico" />
                <span>{l.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => setCmdkOpen(true)}
            className="w-full flex items-center gap-2 px-2 h-8 rounded-[6px] text-[12px]"
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border-mid)",
              color: "var(--text-dim)",
            }}
          >
            <Icon name="search" />
            <span className="flex-1 text-left">Quick search</span>
            <span className="kbd">⌘K</span>
          </button>
        </div>
      </aside>

      <div className="content" style={{ marginLeft: "var(--side)" }}>
        <header className="topbar">
          <div className="flex items-center gap-2">
            <button
              className="btn-ghost btn btn-sm md:hidden"
              onClick={() => setSideOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              <Icon name="menu" />
            </button>
            <Breadcrumb pathname={pathname} />
          </div>

          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => setCmdkOpen(true)}
              className="hidden sm:inline-flex btn btn-sm btn-ghost"
              aria-label="Open command palette"
            >
              <Icon name="search" />
              <span className="kbd ml-1">⌘K</span>
            </button>
            <a
              href="https://getwebfetch.com/status"
              target="_blank"
              rel="noreferrer"
              className="hidden md:inline-flex items-center gap-1.5 text-[12px]"
              style={{ color: "var(--text-dim)" }}
            >
              <span className="dot pulse" style={{ color: "var(--ok)" }} />
              All systems normal
            </a>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="size-8 rounded-full flex items-center justify-center text-[12px] font-medium"
              style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)" }}
              aria-label="Profile menu"
            >
              {(userLabel || "?").slice(0, 1).toUpperCase()}
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-2 min-w-[220px] rounded-[8px] p-1 z-40"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)" }}
              >
                <div className="px-3 py-2">
                  <div className="text-[13px] truncate">{userLabel}</div>
                  <div className="mono text-[11px] truncate" style={{ color: "var(--text-mute)" }}>
                    {userEmail}
                  </div>
                </div>
                <div className="rule my-1" />
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 h-8 rounded-[6px] text-[13px] hover:bg-white/5"
                >
                  <Icon name="cog" /> Settings
                </Link>
                <Link
                  href="/billing"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 h-8 rounded-[6px] text-[13px] hover:bg-white/5"
                >
                  <Icon name="card" /> Billing
                </Link>
                <a
                  href="https://getwebfetch.com/docs"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-3 h-8 rounded-[6px] text-[13px] hover:bg-white/5"
                >
                  <Icon name="book" /> Docs
                </a>
                <div className="rule my-1" />
                <button
                  onClick={async () => {
                    await fetch("/api/proxy/v1/auth/signout", {
                      method: "POST",
                      credentials: "include",
                    }).catch(() => {});
                    router.push("/login");
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 h-8 rounded-[6px] text-[13px] hover:bg-white/5"
                  style={{ color: "var(--danger)" }}
                >
                  <Icon name="out" /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-[1280px] px-6 py-8">{children}</main>

        <footer
          className="mx-auto max-w-[1280px] px-6 py-8 text-[11px] mono flex items-center gap-3"
          style={{ color: "var(--text-mute)" }}
        >
          <span>app.getwebfetch.com</span>
          <span>·</span>
          <a href="https://getwebfetch.com/docs" className="hover:text-[color:var(--text-dim)]">
            docs
          </a>
          <span>·</span>
          <a href="https://getwebfetch.com/status" className="hover:text-[color:var(--text-dim)]">
            status
          </a>
          <span>·</span>
          <a href="mailto:support@getwebfetch.com" className="hover:text-[color:var(--text-dim)]">
            support
          </a>
        </footer>
      </div>

      {cmdkOpen && (
        <CommandPalette
          workspaces={workspaces}
          onClose={() => setCmdkOpen(false)}
          onNavigate={(href) => {
            setCmdkOpen(false);
            router.push(href);
          }}
        />
      )}
    </>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 shrink-0">
      <div
        className="size-6 rounded-[6px] flex items-center justify-center"
        style={{ background: "var(--accent)" }}
      >
        <svg viewBox="0 0 16 16" fill="none" className="size-3.5">
          <path
            d="M3 4l5 3 5-3M3 8l5 3 5-3M3 12l5 3 5-3"
            stroke="#1a0a04"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[14px] font-medium tracking-tight">webfetch</span>
        <span className="mono text-[10.5px]" style={{ color: "var(--text-mute)" }}>
          cloud
        </span>
      </div>
    </Link>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const label =
    pathname === "/"
      ? "Overview"
      : pathname.startsWith("/keys")
        ? "API keys"
        : pathname.startsWith("/usage")
          ? "Usage"
          : pathname.startsWith("/providers")
            ? "Providers"
            : pathname.startsWith("/team")
              ? "Team"
              : pathname.startsWith("/billing")
                ? "Billing"
                : pathname.startsWith("/audit")
                  ? "Audit log"
                  : pathname.startsWith("/settings")
                    ? "Settings"
                    : "";
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span style={{ color: "var(--text-mute)" }}>webfetch</span>
      <span style={{ color: "var(--text-mute)" }}>/</span>
      <span>{label}</span>
    </div>
  );
}
