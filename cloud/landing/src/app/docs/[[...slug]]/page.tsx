import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CopyableCodeEnhancer } from "@/components/docs/CopyableCodeEnhancer";
import { OnPageToc } from "@/components/docs/OnPageToc";
import { PrevNextNav } from "@/components/docs/PrevNextNav";
import { buildBreadcrumbJsonLd } from "@/lib/breadcrumbs";
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
  const canonical = `/docs${slugStr ? `/${slugStr}` : ""}`;
  return {
    title: doc.meta.title,
    description: doc.meta.description,
    alternates: { canonical },
  };
}

function extractFaqPairs(md: string): { q: string; a: string }[] {
  const lines = md.split("\n");
  const out: { q: string; a: string }[] = [];
  let cur: { q: string; a: string } | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (cur && cur.a.trim()) out.push({ q: cur.q, a: cur.a.trim() });
      cur = { q: h2[1], a: "" };
      continue;
    }
    if (cur && !line.startsWith("#")) {
      cur.a += (cur.a ? "\n" : "") + line;
    }
  }
  if (cur && cur.a.trim()) out.push({ q: cur.q, a: cur.a.trim() });
  return out.slice(0, 10).map(({ q, a }) => ({
    q,
    a: a
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500),
  }));
}

function techArticleLd(meta: {
  title: string;
  description?: string;
  slug: string;
}) {
  const url = `https://getwebfetch.com/docs${meta.slug ? `/${meta.slug}` : ""}`;
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: meta.title,
    description: meta.description ?? "",
    url,
    mainEntityOfPage: url,
    proficiencyLevel: "Expert",
    author: { "@type": "Person", name: "Mason Wyatt", url: "https://ashlr.ai" },
    publisher: {
      "@type": "Organization",
      name: "AshlrAI",
      url: "https://ashlr.ai",
      logo: {
        "@type": "ImageObject",
        url: "https://getwebfetch.com/og-image.png",
      },
    },
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

  const techLd = techArticleLd({
    title: doc.meta.title,
    description: doc.meta.description,
    slug: slugStr,
  });
  const faqLd =
    slugStr === "faq"
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: extractFaqPairs(doc.content).map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        }
      : null;

  const crumbs = slugStr
    ? [
        { name: "Docs", path: "/docs" },
        ...slugStr.split("/").map((part, i, arr) => ({
          name: part.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          path: `/docs/${arr.slice(0, i + 1).join("/")}`,
        })),
      ]
    : [{ name: "Docs", path: "/docs" }];
  const breadcrumbLd = buildBreadcrumbJsonLd(crumbs);

  return (
    <div className="xl:flex xl:gap-10">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
        dangerouslySetInnerHTML={{ __html: JSON.stringify(techLd) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      {faqLd && (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />
      )}
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
