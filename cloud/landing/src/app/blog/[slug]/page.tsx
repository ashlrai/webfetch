import { getAllPosts, getPostSource } from "@/lib/blog";
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
    openGraph: {
      title: post.meta.title,
      description: post.meta.excerpt,
      type: "article",
      publishedTime: post.meta.date,
      authors: [post.meta.author],
      images: post.meta.cover ? [post.meta.cover] : ["/og-image.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: post.meta.title,
      description: post.meta.excerpt,
    },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostSource(slug);
  if (!post) return notFound();
  const html = await marked.parse(post.content);
  return (
    <article className="max-w-3xl mx-auto px-6 py-16">
      <div className="text-xs font-mono text-[var(--fg-dim)] flex items-center gap-3">
        <Link href="/blog">← blog</Link>
        <span>·</span>
        <time>{post.meta.date}</time>
        <span>·</span>
        <span>{post.meta.readTime}</span>
        <span>·</span>
        <span>by {post.meta.author}</span>
      </div>
      <div className="prose-wf mt-6" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
