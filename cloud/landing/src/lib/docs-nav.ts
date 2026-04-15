/** Source-of-truth nav order for /docs. Pure data — safe for client imports. */
export const DOC_NAV: {
  section: string;
  items: { slug: string; title: string }[];
}[] = [
  {
    section: "Introduction",
    items: [
      { slug: "", title: "Overview" },
      { slug: "getting-started", title: "Getting started" },
      { slug: "faq", title: "FAQ" },
    ],
  },
  {
    section: "Core concepts",
    items: [
      { slug: "providers", title: "Providers" },
      { slug: "license-safety", title: "License safety" },
      { slug: "browser", title: "Browser layer" },
    ],
  },
  {
    section: "Interfaces",
    items: [
      { slug: "cli", title: "CLI reference" },
      { slug: "api", title: "HTTP API" },
      { slug: "mcp", title: "MCP overview" },
    ],
  },
  {
    section: "MCP per IDE",
    items: [
      { slug: "mcp/claude-code", title: "Claude Code" },
      { slug: "mcp/cursor", title: "Cursor" },
      { slug: "mcp/cline", title: "Cline" },
      { slug: "mcp/continue", title: "Continue" },
      { slug: "mcp/roo", title: "Roo Code" },
      { slug: "mcp/codex", title: "Codex" },
    ],
  },
  {
    section: "Cookbook",
    items: [
      { slug: "cookbook", title: "All recipes" },
      { slug: "cookbook/recipe-1", title: "1. CC0 album cover" },
      { slug: "cookbook/recipe-2", title: "2. Bulk artist portraits" },
      { slug: "cookbook/recipe-3", title: "3. Verify license of a URL" },
      { slug: "cookbook/recipe-4", title: "4. Watch with webhook" },
      { slug: "cookbook/recipe-5", title: "5. Enrich a blog post" },
      { slug: "cookbook/recipe-6", title: "6. GitHub Action build" },
      { slug: "cookbook/recipe-7", title: "7. Self-host MCP" },
      { slug: "cookbook/recipe-8", title: "8. Vision alt-text" },
      { slug: "cookbook/recipe-9", title: "9. pHash dedupe" },
      { slug: "cookbook/recipe-10", title: "10. Custom provider" },
    ],
  },
  {
    section: "Operations",
    items: [
      { slug: "self-hosting", title: "Self-hosting" },
      { slug: "changelog", title: "Changelog" },
    ],
  },
];

export function flatDocOrder(): { slug: string; title: string }[] {
  return DOC_NAV.flatMap((s) => s.items);
}

export function getDocPrevNext(slug: string) {
  const list = flatDocOrder();
  const idx = list.findIndex((i) => i.slug === slug);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? list[idx - 1]! : null,
    next: idx < list.length - 1 ? list[idx + 1]! : null,
  };
}
