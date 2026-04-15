"use client";
import { useEffect } from "react";

/** Runs after mount on a docs page: injects copy buttons into every <pre>. */
export function CopyableCodeEnhancer() {
  useEffect(() => {
    const pres = document.querySelectorAll<HTMLPreElement>(".docs-article pre");
    pres.forEach((pre) => {
      if (pre.dataset.enhanced) return;
      pre.dataset.enhanced = "1";
      pre.style.position = "relative";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.className =
        "absolute top-2 right-2 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] hover:border-[var(--color-accent)] transition-colors";
      btn.addEventListener("click", async () => {
        const code = pre.querySelector("code");
        const text = code?.textContent ?? pre.textContent ?? "";
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = "copied";
          setTimeout(() => {
            btn.textContent = "copy";
          }, 1200);
        } catch {
          btn.textContent = "error";
        }
      });
      pre.appendChild(btn);
    });
  }, []);
  return null;
}
