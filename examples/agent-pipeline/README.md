# Recipe: illustrate a document with license-safe images

A writing or docs agent needs one image per section and must be able to say
who made each image and under which license. This recipe does that with the
`webfetch-core` library:

1. `searchImages(topic, { licensePolicy: "open-only" })` federates keyless
   providers and ranks results license-first. `UNKNOWN` licenses never pass.
2. `downloadImage(url)` fetches the top candidate with SSRF guards and a size cap
   (falls through to the next candidate if a download fails).
3. The recipe writes `CREDITS.md` (one attribution line per image) and
   `manifest.json` (file, license, source page, SHA-256) next to the images.

## Run

From the repo root, after `bun install && bun run --cwd packages/core build`:

```bash
bun examples/agent-pipeline/illustrate.ts "apollo 11 moon landing" "saturn rings" "red panda" --out ./illustrations
```

Output from a real run (Sep 29, 2026):

```text
ok   apollo 11 moon landing -> apollo-11-moon-landing.jpg [PUBLIC_DOMAIN]
ok   saturn rings -> saturn-rings.jpg [PUBLIC_DOMAIN]
ok   red panda -> red-panda.jpg [CC0]

Wrote /…/illustrations/CREDITS.md and manifest.json
```

```markdown
# Image credits

- `saturn-rings.jpg`: "Saturn from Cassini Orbiter (2004-10-06).jpg" by NASA/JPL/Space Science Institute (Wikimedia Commons), licensed Public Domain — https://commons.wikimedia.org/wiki/File%3ASaturn%20from%20Cassini%20Orbiter%20(2004-10-06).jpg
```

Results depend on live provider data, so your images may differ. The script
exits 1 only if no topic produced an image.

## Use it from your own code

```ts
import { illustrate } from "./examples/agent-pipeline/illustrate.ts";

const entries = await illustrate(["red panda"], { outDir: "public/img" });
// entries[0].attribution -> paste into the caption
```

Options: `providers`, `licensePolicy` (`open-only` | `safe-only` | …),
`timeoutMs`, and `fetcher` (inject `fetch` for tests; see
[illustrate.test.ts](illustrate.test.ts)).

## Notes

- `open-only` still includes CC BY and CC BY-SA, which require attribution
  (and share-alike for BY-SA). Keep `CREDITS.md` with the images.
- Providers can rate-limit (Wikimedia returns HTTP 429 at times). The recipe
  records a skip instead of failing the whole run.
