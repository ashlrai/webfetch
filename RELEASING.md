# Releasing webfetch

All four publishable packages (`@webfetch/core`, `@webfetch/cli`,
`@webfetch/mcp`, `@webfetch/server`) release together off a single git tag.

## Prerequisites (one-time)

- Add `NPM_TOKEN` (automation token, `publish` scope) as a GitHub Actions
  secret on the `ashlr-ai/webfetch` repo.
- Add `HOMEBREW_GH_TOKEN` as a GitHub Actions secret. This is a fine-scoped
  Personal Access Token with `contents: write` permission on
  `ashlr-ai/homebrew-webfetch` only — the `homebrew-bump` job in
  `release.yml` uses it to open a PR (or push a commit) bumping
  `Formula/webfetch.rb` after each successful npm publish.
- Be logged in to npm locally for dry-runs: `npm whoami`.
- Confirm you have write access to `ghcr.io/ashlr-ai/webfetch`.

## Automated release (recommended)

1. Bump + commit + tag locally. Versions are derived from the tag — the
   release workflow rewrites each `packages/*/package.json` to match.
   ```bash
   VERSION=0.2.0
   git tag -a "v${VERSION}" -m "v${VERSION}"
   git push origin "v${VERSION}"
   ```
2. Watch `.github/workflows/release.yml`:
   - runs typecheck + tests
   - builds every package
   - `npm publish --access public --provenance` for all four
   - creates a GitHub Release with built tarballs attached
3. `.github/workflows/docker.yml` fires on the same tag and pushes the
   multi-arch image to `ghcr.io/ashlr-ai/webfetch:<version>` + `:latest`.
4. The `homebrew-bump` job in `release.yml` opens (or updates) a PR on
   `github.com/ashlr-ai/homebrew-webfetch` bumping `Formula/webfetch.rb`
   automatically. Merge that PR to ship the new version through `brew`.
   If the job is skipped or fails, fall back to a manual edit per
   `homebrew/README.md`.

## Manual release (break-glass)

```bash
bun install --frozen-lockfile
bun run typecheck
bun test

# Sync versions across packages.
VERSION=0.2.0
for pkg in core cli mcp server; do
  node -e "const f='packages/$pkg/package.json';const j=require('./'+f);j.version='$VERSION';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
done

# Build.
bun run --cwd packages/core build
bun run --cwd packages/cli build
bun run --cwd packages/mcp build
bun run --cwd packages/server build

# Dry-run the publishable file list.
cd packages/core && npm pack --dry-run && cd -
cd packages/cli  && npm pack --dry-run && cd -
cd packages/mcp  && npm pack --dry-run && cd -
cd packages/server && npm pack --dry-run && cd -

# Publish.
( cd packages/core   && npm publish --access public )
( cd packages/cli    && npm publish --access public )
( cd packages/mcp    && npm publish --access public )
( cd packages/server && npm publish --access public )

# Tag + GitHub Release.
git tag -a "v${VERSION}" -m "v${VERSION}"
git push origin "v${VERSION}"
gh release create "v${VERSION}" --generate-notes
```

## Version policy

- `0.x.y` while APIs are still shifting. Breaking changes bump `x`.
- Post-1.0: strict SemVer across the four packages; they release in lockstep.

## Post-release verification

- `npm i -g @webfetch/cli && webfetch --help`
- `docker run --rm ghcr.io/ashlr-ai/webfetch:${VERSION} cli --help`
- `brew upgrade webfetch` (after the tap PR merges)
