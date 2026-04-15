import { getAllPosts, getPostSource } from "@/lib/blog";
import { buildBreadcrumbJsonLd } from "@/lib/breadcrumbs";
import { marked } from "marked";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostSource(slug);
  if (!post) return {};
  return {
    title: post.meta.title,
    description: post.meta.excerpt,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      title: post.meta.title,
      description: post.meta.excerpt,
      url: `https://getwebfetch.com/blog/${slug}`,
      type: "article",
      publishedTime: post.meta.date,
      authors: [post.meta.author],
      images: post.meta.cover ? [post.meta.cover] : ["/og-image.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: post.meta.title,
      description: post.meta.excerpt,
      images: post.meta.cover ? [post.meta.cover] : ["/og-image.png"],
    },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostSource(slug);
  if (!post) return notFound();
  const html = await marked.parse(post.content);
  const canonical = `https://getwebfetch.com/blog/${slug}`;
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.meta.title,
    description: post.meta.excerpt,
    datePublished: post.meta.date,
    dateModified: post.meta.date,
    author: {
      "@type": "Person",
      name: post.meta.author,
      url: "https://ashlr.ai",
    },
    image: `${canonical}/opengraph-image`,
    mainEntityOfPage: canonical,
    url: canonical,
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
  const breadcrumbLd = buildBreadcrumbJsonLd([
    { name: "Blog", path: "/blog" },
    { name: post.meta.title, path: `/blog/${slug}` },
  ]);
  return (
    <article className="max-w-3xl mx-auto px-6 py-16">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <div className="text-xs font-mono text-[var(--fg-dim)] flex items-center gap-3">
        <Link href="/blog">← blog</Link>
        <span>·</span>
        <time dateTime={post.meta.date}>{post.meta.date}</time>
        <span>·</span>
        <span>{post.meta.readTime}</span>
        <span>·</span>
        <span>by {post.meta.author}</span>
      </div>
      <div className="prose-wf mt-6" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
