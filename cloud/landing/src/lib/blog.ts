import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type BlogMeta = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  author: string;
  cover?: string;
};

const BLOG_DIR = path.join(process.cwd(), "src", "content", "blog");

export function getAllPosts(): BlogMeta[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".mdx"));
  return files
    .map((file) => {
      const raw = fs.readFileSync(path.join(BLOG_DIR, file), "utf-8");
      const { data } = matter(raw);
      return {
        slug: (data.slug as string) ?? file.replace(/\.mdx$/, ""),
        title: data.title as string,
        excerpt: data.excerpt as string,
        date: data.date as string,
        readTime: data.readTime as string,
        author: data.author as string,
        cover: data.cover as string | undefined,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostSource(slug: string): { content: string; meta: BlogMeta } | null {
  const fp = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, "utf-8");
  const { data, content } = matter(raw);
  return {
    content,
    meta: {
      slug: (data.slug as string) ?? slug,
      title: data.title as string,
      excerpt: data.excerpt as string,
      date: data.date as string,
      readTime: data.readTime as string,
      author: data.author as string,
      cover: data.cover as string | undefined,
    },
  };
}
