/**
 * Helper for emitting schema.org BreadcrumbList JSON-LD per route.
 * Use `buildBreadcrumbJsonLd(items)` and drop it into a <script type="application/ld+json">.
 */
const SITE = "https://getwebfetch.com";

export type Crumb = { name: string; path: string };

export function buildBreadcrumbJsonLd(items: Crumb[]) {
  // Always prepend the site root as the first crumb.
  const full: Crumb[] = items[0]?.path === "/" ? items : [{ name: "webfetch", path: "/" }, ...items];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: full.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE}${c.path === "/" ? "" : c.path}`,
    })),
  };
}

export function breadcrumbScriptTag(items: Crumb[]): string {
  return JSON.stringify(buildBreadcrumbJsonLd(items));
}
