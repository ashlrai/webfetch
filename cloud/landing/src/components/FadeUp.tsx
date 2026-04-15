"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Signature motion for webfetch: 12px translate + 200ms opacity on scroll-in.
 * Uses IntersectionObserver, unobserves after first reveal.
 */
export function FadeUp({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (delay) setTimeout(() => setVisible(true), delay);
            else setVisible(true);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      data-visible={visible ? "true" : "false"}
      className={`wf-fade-up ${className}`}
    >
      {children}
    </div>
  );
}
