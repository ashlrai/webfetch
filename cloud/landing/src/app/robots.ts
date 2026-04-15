import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/_next/", "/admin/"],
      },
      // Encourage image crawlers (our main "proof" is the gallery).
      { userAgent: "Googlebot-Image", allow: "/" },
      { userAgent: "Bingbot", allow: "/" },
    ],
    sitemap: "https://getwebfetch.com/sitemap.xml",
    host: "https://getwebfetch.com",
  };
}
