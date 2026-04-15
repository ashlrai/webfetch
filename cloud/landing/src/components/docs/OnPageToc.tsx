import type { DocHeading } from "@/lib/docs";

export function OnPageToc({ headings }: { headings: DocHeading[] }) {
  if (headings.length === 0) return null;
  return (
    <aside className="hidden xl:block w-56 shrink-0 sticky top-20 h-[calc(100vh-6rem)] overflow-y-auto">
      <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-fg-faint)] mb-3">
        On this page
      </div>
      <ul className="space-y-1.5 font-mono text-[12px]">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
            <a
              href={`#${h.id}`}
              className="text-[var(--color-fg-dim)] hover:text-[var(--color-accent)] transition-colors block leading-snug"
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
