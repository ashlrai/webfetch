import Link from "next/link";
import { getDocPrevNext } from "@/lib/docs-nav";

export function PrevNextNav({ slug }: { slug: string }) {
  const { prev, next } = getDocPrevNext(slug);
  if (!prev && !next) return null;
  return (
    <nav className="mt-16 pt-8 border-t border-[var(--color-border)] grid grid-cols-2 gap-4 font-mono text-sm">
      <div>
        {prev && (
          <Link
            href={prev.slug ? `/docs/${prev.slug}` : "/docs"}
            className="wf-card block hover:border-[var(--color-accent)]"
          >
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-fg-faint)]">
              Previous
            </div>
            <div className="mt-1 text-[var(--color-fg)]">← {prev.title}</div>
          </Link>
        )}
      </div>
      <div className="text-right">
        {next && (
          <Link
            href={next.slug ? `/docs/${next.slug}` : "/docs"}
            className="wf-card block hover:border-[var(--color-accent)]"
          >
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-fg-faint)]">
              Next
            </div>
            <div className="mt-1 text-[var(--color-fg)]">{next.title} →</div>
          </Link>
        )}
      </div>
    </nav>
  );
}
