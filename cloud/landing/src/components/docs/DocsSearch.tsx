"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Entry = {
  slug: string;
  title: string;
  description?: string;
  headings: string[];
  body: string;
};

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open && !entries) {
      fetch("/docs-index.json")
        .then((r) => r.json())
        .then((d) => setEntries(d as Entry[]))
        .catch(() => setEntries([]));
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open, entries]);

  const results = useMemo(() => {
    if (!entries || !q.trim()) return [];
    const needle = q.toLowerCase();
    const terms = needle.split(/\s+/).filter(Boolean);
    const scored = entries
      .map((e) => {
        const hay = `${e.title}\n${e.description ?? ""}\n${e.headings.join("\n")}\n${e.body}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (e.title.toLowerCase().includes(t)) score += 10;
          if (e.headings.some((h) => h.toLowerCase().includes(t))) score += 5;
          if (hay.includes(t)) score += 1;
          else return { e, score: -1 };
        }
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    return scored.map((s) => s.e);
  }, [entries, q]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-fg-dim)] font-mono text-[13px] hover:border-[var(--color-border-hover)]"
        aria-label="Search docs"
      >
        <span>Search docs</span>
        <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
          ⌘K
        </span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the docs…"
              className="w-full px-4 py-4 bg-transparent text-[var(--color-fg)] font-mono text-sm outline-none border-b border-[var(--color-border)]"
            />
            <div className="max-h-[60vh] overflow-y-auto">
              {!entries && (
                <div className="p-6 text-sm text-[var(--color-fg-dim)] font-mono">
                  Loading index…
                </div>
              )}
              {entries && q.trim() && results.length === 0 && (
                <div className="p-6 text-sm text-[var(--color-fg-dim)] font-mono">
                  No matches for “{q}”.
                </div>
              )}
              {results.map((r) => (
                <Link
                  key={r.slug || "index"}
                  href={r.slug ? `/docs/${r.slug}` : "/docs"}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elev-2)]"
                >
                  <div className="font-mono text-sm text-[var(--color-fg)]">{r.title}</div>
                  {r.description && (
                    <div className="text-xs text-[var(--color-fg-dim)] mt-0.5 line-clamp-1">
                      {r.description}
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--color-fg-faint)] font-mono mt-1">
                    /docs/{r.slug}
                  </div>
                </Link>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-[var(--color-border)] text-[11px] font-mono text-[var(--color-fg-faint)] flex justify-between">
              <span>Enter to open · Esc to close</span>
              <span>{results.length} results</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
