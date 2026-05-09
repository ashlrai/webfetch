# webfetch-core

License-aware federated image search primitives for agents, CLIs, servers, and apps.

## Install

```bash
npm install webfetch-core
```

## Usage

```ts
import { searchImages, downloadImage } from "webfetch-core";

const results = await searchImages("apollo 11 moon", {
  licensePolicy: "safe-only",
  providers: ["wikimedia", "nasa", "openverse"],
  maxPerProvider: 5,
});

const top = results.candidates[0];
if (top) {
  const downloaded = await downloadImage(top.url);
  console.log(downloaded.cachedPath, downloaded.sha256);
}
```

## License Tags

Core distinguishes open licenses from platform and editorial licenses:

- Open/commercial reusable: `CC0`, `PUBLIC_DOMAIN`, `CC_BY`, `CC_BY_SA`
- Platform-license: `UNSPLASH_LICENSE`, `PEXELS_LICENSE`, `PIXABAY_LICENSE`
- Context/editorial: `EDITORIAL_LICENSED`, `PRESS_KIT_ALLOWLIST`
- Exploration only: `UNKNOWN`

Use `licensePolicy: "open-only"` when only Creative Commons/public-domain assets are acceptable.

## Migration Notes

Unsplash, Pexels, and Pixabay are no longer represented as `CC0`. They now
return `UNSPLASH_LICENSE`, `PEXELS_LICENSE`, and `PIXABAY_LICENSE` so callers
can separate platform terms from Creative Commons/public-domain results.

Policy behavior:

- `open-only`: allows `CC0`, `PUBLIC_DOMAIN`, `CC_BY`, and `CC_BY_SA`.
- `safe-only`: allows open tags plus platform licenses, editorial licenses,
  and press-kit allowlist results; rejects `UNKNOWN`.
- `prefer-safe`: keeps unsafe results but ranks safe results first.
- `any`: returns all results, including `UNKNOWN`.

Update exhaustive `License` switches and persisted test fixtures before
upgrading cached results produced by older builds.
