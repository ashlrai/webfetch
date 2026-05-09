# webfetch-browser

Browser-assisted extraction helpers for webfetch. This package is for pages where
ordinary provider APIs or static HTML probes are not enough.

## Install

```bash
npm install webfetch-browser
```

## Use

```ts
import { createBrowserProvider } from "webfetch-browser";

const provider = await createBrowserProvider({
  stack: "vanilla",
  respectRobots: true,
});

const candidates = await provider.search("artist portrait");
console.log(candidates);
```

Browser-sourced results are leads for review. They should not be treated as
cleared assets unless a source page or embedded metadata provides a usable
license.
