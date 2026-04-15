import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";

const SITE = "https://getwebfetch.com";

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
    { url: `${SITE}/legal/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/legal/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    {
      url: `${SITE}/legal/license-policy`,
      lastModified: now,
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

  return [...staticRoutes, ...blogRoutes];
}
