"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

/**
 * Tiny modal with focus trap. ~40 LOC of actual logic — rolled inline per
 * the no-new-deps constraint.
 */
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    lastFocused.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (!node) return;

    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input:not([type="hidden"]):not([disabled]), select, [tabindex]:not([tabindex="-1"])',
        ),
      );
    const first = focusable()[0];
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusable();
      if (els.length === 0) return;
      const f = els[0];
      const l = els[els.length - 1];
      if (e.shiftKey && document.activeElement === f) {
        e.preventDefault();
        l.focus();
      } else if (!e.shiftKey && document.activeElement === l) {
        e.preventDefault();
        f.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    const prevBody = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevBody;
      lastFocused.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div ref={ref} className="modal" style={{ maxWidth: width }}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <h2 className="h2">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-dim)" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div>{children}</div>
        {footer && <div className="mt-5 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
