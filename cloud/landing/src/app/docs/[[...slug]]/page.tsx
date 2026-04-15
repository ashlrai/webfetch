import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CopyableCodeEnhancer } from "@/components/docs/CopyableCodeEnhancer";
import { OnPageToc } from "@/components/docs/OnPageToc";
import { PrevNextNav } from "@/components/docs/PrevNextNav";
import { flatOrder, loadDoc } from "@/lib/docs";

export function generateStaticParams() {
  return flatOrder().map((i) => ({
    slug: i.slug ? i.slug.split("/") : undefined,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const slugStr = (slug ?? []).join("/");
  const doc = loadDoc(slugStr);
  if (!doc) return { title: "Docs" };
  return {
    title: doc.meta.title,
    description: doc.meta.description,
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const slugStr = (slug ?? []).join("/");
  const doc = loadDoc(slugStr);
  if (!doc) return notFound();

  return (
    <div className="xl:flex xl:gap-10">
      <article className="docs-article min-w-0 flex-1 max-w-3xl">
        <header className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--color-fg-faint)] mb-2">
            {doc.meta.section ?? "Docs"}
          </div>
          <h1 className="text-3xl md:text-4xl font-mono font-semibold tracking-tight text-[var(--color-fg)]">
            {doc.meta.title}
          </h1>
          {doc.meta.description && (
            <p className="mt-3 text-[var(--color-fg-dim)] text-base leading-relaxed">
              {doc.meta.description}
            </p>
          )}
        </header>
        <div
          className="prose-wf"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted MDX content
          dangerouslySetInnerHTML={{ __html: doc.html }}
        />
        <PrevNextNav slug={slugStr} />
        <CopyableCodeEnhancer />
      </article>
      <OnPageToc headings={doc.headings} />
    </div>
  );
}
