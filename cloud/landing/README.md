# webfetch landing site

Next.js 15 App Router + Tailwind 4 + TypeScript. Deployed to Vercel at `getwebfetch.com`.

## Dev

```bash
bun install
bun run --cwd cloud/landing dev
```

Open http://localhost:3100.

## Build

```bash
bun run --cwd cloud/landing build
bun run --cwd cloud/landing typecheck
```

## Routes

| Route | Description |
| --- | --- |
| `/` | Landing — hero, features, architecture, providers, compare, CTA |
| `/pricing` | Pricing ladder + FAQ |
| `/compare` | webfetch vs Google / Unsplash / Bing / Serper |
| `/blog` | Blog index |
| `/blog/[slug]` | Individual MDX post (markdown rendered server-side) |
| `/docs` | Docs index (links out to repo docs + license policy) |
| `/mcp-registry` | MCP manifest + per-agent install snippets |
| `/legal/terms` | Terms of Service |
| `/legal/privacy` | Privacy Policy |
| `/legal/license-policy` | License policy (attribution rules, confidence rubric) |

## Environment

- `NEXT_PUBLIC_API_URL` — cloud API base URL. Defaults to `http://localhost:7777` in dev; set to `https://api.getwebfetch.com` in production.

## Content

- `src/content/blog/*.mdx` — blog posts, rendered via `marked` with frontmatter parsed by `gray-matter`.
- `public/mcp/manifest.json` — machine-readable MCP manifest served for agent discovery.

## Launch assets

See `launch/` for HN, X, Product Hunt, dev.to, YouTube outreach, and demo script.
