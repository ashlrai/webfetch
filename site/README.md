# site/

Static landing page. Plain HTML + CSS + ~20 lines of JS (copy button only).
No framework, no build step.

## Local preview

```bash
./site/preview.sh
# open http://localhost:4173
```

## Deploy

- **Vercel / Netlify**: point the project root at `site/` with no build command.
- **GitHub Pages**: commit, enable Pages for the `site/` folder.
- **Cloudflare Pages**: output directory `site/`, build command empty.

## Editing

Everything is in three files:

- `index.html` — content + structure
- `styles.css` — design tokens + layout
- `site.js` — copy-to-clipboard for the install command

Dark mode is automatic via `prefers-color-scheme`. Mobile breakpoints at 640px.
