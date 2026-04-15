import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";
import { DOC_NAV, flatDocOrder, getDocPrevNext } from "./docs-nav";

export { DOC_NAV, flatDocOrder as flatOrder, getDocPrevNext as getPrevNext };

export type DocMeta = {
  slug: string;
  title: string;
  description?: string;
  section?: string;
  order?: number;
};

export type DocHeading = { id: string; text: string; level: number };

const DOCS_DIR = path.join(process.cwd(), "src", "content", "docs");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getAllDocSlugs(): string[] {
  const out: string[] = [];
  function walk(dir: string, prefix: string) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full, prefix ? `${prefix}/${f}` : f);
      else if (f.endsWith(".mdx") || f.endsWith(".md")) {
        const base = f.replace(/\.mdx?$/, "");
        const slug = prefix
          ? base === "index"
            ? prefix
            : `${prefix}/${base}`
          : base === "index"
            ? ""
            : base;
        out.push(slug);
      }
    }
  }
  walk(DOCS_DIR, "");
  return out;
}

function tryReadFile(slug: string): string | null {
  const candidates = [
    path.join(DOCS_DIR, `${slug}.mdx`),
    path.join(DOCS_DIR, `${slug}.md`),
    path.join(DOCS_DIR, slug, "index.mdx"),
    path.join(DOCS_DIR, slug, "index.md"),
  ];
  if (slug === "") {
    candidates.unshift(path.join(DOCS_DIR, "index.mdx"), path.join(DOCS_DIR, "index.md"));
  }
  for (const c of candidates) if (fs.existsSync(c)) return fs.readFileSync(c, "utf-8");
  return null;
}

export type LoadedDoc = {
  meta: DocMeta;
  content: string;
  html: string;
  headings: DocHeading[];
};

export function loadDoc(slug: string): LoadedDoc | null {
  const raw = tryReadFile(slug);
  if (!raw) return null;
  const { data, content } = matter(raw);
  const headings: DocHeading[] = [];
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }: any) => {
    const text = tokens.map((t: any) => t.raw ?? t.text ?? "").join("");
    const id = slugify(text);
    if (depth === 2 || depth === 3) headings.push({ id, text, level: depth });
    return `<h${depth} id="${id}"><a class="wf-h-anchor" href="#${id}">#</a>${text}</h${depth}>`;
  };
  renderer.code = ({ text, lang }: any) => {
    const cls = lang ? ` class="language-${lang}"` : "";
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre data-lang="${lang ?? ""}"><code${cls}>${escaped}</code></pre>`;
  };
  const html = marked.parse(content, { renderer, async: false }) as string;
  return {
    meta: {
      slug,
      title: (data.title as string) ?? slug,
      description: data.description as string | undefined,
      section: data.section as string | undefined,
      order: data.order as number | undefined,
    },
    content,
    html,
    headings,
  };
}

/** Search index: slug -> { title, headings, snippet } */
export type SearchEntry = {
  slug: string;
  title: string;
  description?: string;
  headings: string[];
  body: string;
};

export function buildSearchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const { slug } of flatDocOrder()) {
    const doc = loadDoc(slug);
    if (!doc) continue;
    entries.push({
      slug,
      title: doc.meta.title,
      description: doc.meta.description,
      headings: doc.headings.map((h) => h.text),
      body: doc.content.slice(0, 2400).replace(/\s+/g, " "),
    });
  }
  return entries;
}
