"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DOC_NAV } from "@/lib/docs-nav";

export function DocsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const navContent = (
    <div className="space-y-6 font-mono text-[13px]">
      {DOC_NAV.map((section) => (
        <div key={section.section}>
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-fg-faint)] mb-2 px-1">
            {section.section}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const href = item.slug ? `/docs/${item.slug}` : "/docs";
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`block py-1 px-2 rounded-md border-l-2 transition-colors ${
                      active
                        ? "border-[var(--color-accent)] text-[var(--color-fg)] bg-[var(--color-bg-elev)]"
                        : "border-transparent text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] hover:border-[var(--color-border-hover)]"
                    }`}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Desktop inline render — parent provides sticky positioning. */}
      <div className="hidden lg:block">{navContent}</div>
      {/* Mobile drawer toggle */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="fixed bottom-4 right-4 z-40 wf-btn-primary text-xs"
          aria-expanded={open}
          aria-label="Toggle docs navigation"
        >
          {open ? "Close" : "Docs menu"}
        </button>
        {open && (
          <div
            className="fixed inset-0 z-30 bg-[var(--color-bg)] pt-20 px-6 pb-24 overflow-y-auto"
            role="dialog"
            aria-label="Docs navigation"
          >
            {navContent}
          </div>
        )}
      </div>
    </>
  );
}
