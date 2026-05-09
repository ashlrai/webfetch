# NPM_TOKEN Setup

Goal: publish the public npm packages headlessly from release tags.

The public package names are intentionally unscoped so installs are short and
the CLI owns the obvious command:

- `getwebfetch`
- `webfetch-core`
- `getwebfetch-mcp`
- `webfetch-server`
- `webfetch-browser`

## One-Time Token

1. Open https://www.npmjs.com/settings/masonwyatt23/tokens.
2. Generate a granular access token with read/write package access.
3. Include the five package names above, or use package-wide write access for
   the first publish.
4. Store it in GitHub Actions:

```bash
gh secret set NPM_TOKEN -R ashlrai/webfetch
```

The release workflow publishes with provenance on `v*` tags.

## Local Preflight

```bash
bun install
bun run typecheck
bun test

for pkg in core cli mcp server browser; do
  (cd "packages/$pkg" && npm pack --dry-run | tail -5)
done
```

## First Publish

The first release can be done locally if the token is already available:

```bash
cd packages/core && npm publish --access public --provenance
cd ../cli && npm publish --access public --provenance
cd ../mcp && npm publish --access public --provenance
cd ../server && npm publish --access public --provenance
cd ../browser && npm publish --access public --provenance
```

After that, prefer tags:

```bash
git tag v0.1.0
git push origin v0.1.0
gh run watch -R ashlrai/webfetch
```

## Expected Result

- npm packages: `getwebfetch`, `webfetch-core`, `getwebfetch-mcp`,
  `webfetch-server`, `webfetch-browser`
- GitHub release: `v0.1.0`
- Homebrew tap PR pointing at
  `https://registry.npmjs.org/getwebfetch/-/getwebfetch-0.1.0.tgz`

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `E404` on first publish | Package name is unavailable or token cannot create it. Confirm with `npm view <name> version`. |
| `E403` | Token lacks write access to that package name. Regenerate or broaden token permissions. |
| `ENEEDAUTH` | `NPM_TOKEN` is missing or npm is not logged in locally. |
| Provenance fails | Confirm the release workflow has `id-token: write`. |
| Homebrew bump fails | `HOMEBREW_GH_TOKEN` is missing or lacks write access to `ashlrai/homebrew-webfetch`. |

Last verified: 2026-05-09.
