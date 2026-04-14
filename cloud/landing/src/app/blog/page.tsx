import Link from "next/link";
import type { Metadata } from "next";
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description: "Essays on licensed image sourcing, MCP, and shipping webfetch.",
};

export default function BlogIndex() {
  const posts = getAllPosts();
  return (
    <section className="max-w-3xl mx-auto px-6 py-20">
      <h1 className="text-4xl font-semibold tracking-tight">Blog</h1>
      <p className="mt-3 text-[var(--fg-dim)]">
        Essays on licensed image sourcing, MCP, and the engineering behind webfetch.
      </p>
      <div className="mt-10 divide-y divide-[var(--border)]">
        {posts.map((p) => (
          <Link
            key={p.slug}
            href={`/blog/${p.slug}`}
            className="block py-6 group"
          >
            <div className="flex items-baseline gap-4 text-xs text-[var(--fg-dim)] font-mono">
              <time>{p.date}</time>
              <span>·</span>
              <span>{p.readTime}</span>
            </div>
            <div className="mt-2 text-xl font-semibold group-hover:text-[var(--accent)] transition-colors">
              {p.title}
            </div>
            <p className="mt-2 text-[var(--fg-dim)]">{p.excerpt}</p>
            <div className="mt-2 text-xs text-[var(--fg-dim)]">by {p.author}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
