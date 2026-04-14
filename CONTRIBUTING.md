# Contributing to webfetch

Thanks for your interest. webfetch is an OSS project under MIT — issues, PRs, and new provider proposals are all welcome.

## Dev setup

```bash
git clone https://github.com/ashlr-ai/webfetch
cd webfetch
bun install
bun test
```

You need [Bun](https://bun.sh) >= 1.1. Node 20+ also works for runtime, but the workspace scripts assume Bun.

## Branching

- Cut feature branches off `main`: `feat/short-name`, `fix/short-name`, `docs/short-name`, `provider/short-name`.
- Keep branches focused — one logical change per PR.
- Rebase on `main` before requesting review; we squash-merge.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(core): add license coercion for Smithsonian Open Access
fix(mcp): handle empty candidate list in search_artist_images
docs(providers): document Pixabay rate limits
provider(loc): add Library of Congress adapter
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `provider`, `perf`, `ci`.

## Running tests

Each package can be tested in isolation:

```bash
# Whole workspace
bun test

# A specific package
bun test --filter @webfetch/core
bun test --filter @webfetch/mcp
bun test --filter @webfetch/cli
bun test --filter @webfetch/server

# A single file
bun test packages/core/src/ranker/rank.test.ts
```

Provider adapter tests record live responses once and replay from fixtures (`packages/*/test/fixtures/`). To re-record after a provider API change, set `WEBFETCH_RECORD=1` and re-run that adapter's test.

Lint and typecheck:

```bash
bun run lint        # Biome
bun run typecheck   # tsc --noEmit across workspace
```

## Proposing a new provider

webfetch federates 19+ providers. We accept new providers that meet **all** of the following:

1. **Stable terms of service** that allow programmatic image search/retrieval.
2. **Structured license metadata** in the response, OR a single uniform license that covers every result (e.g. all-CC0).
3. **An attribution string** can be deterministically constructed.
4. **Public API** (no scraping unless gated behind the `browser` opt-in path).

### Adapter contract

Implement `Provider` from `@webfetch/core`:

```ts
export interface Provider {
  id: string;                       // kebab-case, e.g. "smithsonian"
  capabilities: ProviderCapability[]; // e.g. ["search", "artist", "album"]
  search(input: SearchInput): Promise<Candidate[]>;
  // optional: artist(...), album(...), reverse(...)
}
```

Each `Candidate` must include: `url`, `width`, `height`, `license` (one of the `LicenseTag` enum), `attribution`, `provider`, and `confidence` (0-1).

### Review checklist

Open a PR that includes:

- [ ] Adapter implementation in `packages/core/src/providers/<id>/`
- [ ] License coercion mapping in `licenseMap.ts` (include source URL for the policy)
- [ ] Recorded fixtures and a passing test that exercises `search` (and `artist`/`album` if supported)
- [ ] Entry added to the provider table in `README.md` and `docs/PROVIDERS.md`
- [ ] Rate-limit notes + auth env var documented
- [ ] If opt-in, defaults to disabled and listed in the opt-in providers section

For non-trivial providers, open an issue first using the **New provider** template so we can sanity-check terms before you build.

## Reporting issues

Use a template:

- [Bug report](.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature request](.github/ISSUE_TEMPLATE/feature_request.md)
- [New provider](.github/ISSUE_TEMPLATE/new_provider.md)

For security issues, see [SECURITY.md](./SECURITY.md) — do not open a public issue.

## Code style

- TypeScript, `strict: true`, no `any` without justification.
- Formatting and linting via [Biome](./biome.json) — run `bun run lint` before committing.
- Prefer pure functions in `@webfetch/core`. Side-effecting code lives at the surface (cli/mcp/server).
- No new top-level dependencies in `@webfetch/core` without discussion. Provider adapters can pull what they need.

## License

By contributing you agree your contributions are licensed under the [MIT License](./LICENSE).
