import fs from "node:fs";
import path from "node:path";
import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { getAllDocSlugs } from "@/lib/docs";

const SITE = "https://getwebfetch.com";

function mtime(rel: string): Date {
  try {
    const abs = path.join(process.cwd(), rel);
    return fs.statSync(abs).mtime;
  } catch {
    return new Date();
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/compare`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/mcp-registry`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    {
      url: `${SITE}/legal/terms`,
      lastModified: mtime("src/app/legal/terms/page.tsx"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE}/legal/privacy`,
      lastModified: mtime("src/app/legal/privacy/page.tsx"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE}/legal/license-policy`,
      lastModified: mtime("src/app/legal/license-policy/page.tsx"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const blogRoutes: MetadataRoute.Sitemap = getAllPosts().map((p) => ({
    url: `${SITE}/blog/${p.slug}`,
    lastModified: p.date ? new Date(p.date) : now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const docRoutes: MetadataRoute.Sitemap = getAllDocSlugs().map((slug) => {
    // Try to resolve to the real MDX file for accurate lastModified
    const candidates = [
      `src/content/docs/${slug}.mdx`,
      `src/content/docs/${slug}.md`,
      `src/content/docs/${slug}/index.mdx`,
      `src/content/docs/${slug}/index.md`,
      "src/content/docs/index.mdx",
    ];
    let lastMod = now;
    for (const c of candidates) {
      try {
        const abs = path.join(process.cwd(), c);
        if (fs.existsSync(abs)) {
          lastMod = fs.statSync(abs).mtime;
          break;
        }
      } catch {}
    }
    return {
      url: `${SITE}/docs${slug ? `/${slug}` : ""}`,
      lastModified: lastMod,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    };
  });

  return [...staticRoutes, ...blogRoutes, ...docRoutes];
}
