# webfetch GitHub Action

Composite action that installs the `webfetch` CLI and downloads top-N
license-filtered image candidates for a query, with an attribution sidecar
per file and a JSON manifest.

## Usage

```yaml
- uses: ashlrai/webfetch/integrations/github-action@main
  with:
    query: "Drake musician portrait"
    out-dir: ./assets/portraits
    license: safe-only
    max-per-provider: 3
```

After publishing to the GitHub Action marketplace this reduces to:

```yaml
- uses: ashlrai/webfetch-action@v1
  with: { query: "...", out-dir: "./assets" }
```

## Inputs

| Name               | Required | Default          | Description                                               |
| ------------------ | -------- | ---------------- | --------------------------------------------------------- |
| `query`            | yes      | —                | Free-text search query.                                   |
| `out-dir`          | yes      | —                | Directory to write downloaded images + sidecars into.     |
| `license`          | no       | `safe-only`      | `safe-only` \| `prefer-safe` \| `any`.                    |
| `providers`        | no       | (safe defaults)  | Comma-separated provider allowlist.                       |
| `max-per-provider` | no       | `3`              | Cap per provider.                                         |
| `limit`            | no       | `10`             | Total download cap.                                       |
| `min-width`        | no       | `0`              | Minimum image width in pixels.                            |
| `min-height`       | no       | `0`              | Minimum image height in pixels.                           |
| `webfetch-ref`     | no       | `main`           | Git ref of the webfetch repo to build from.               |
| `webfetch-repo`    | no       | (public repo)    | Override repo URL (forks, private mirrors).               |

## Outputs

| Name       | Description                                                       |
| ---------- | ----------------------------------------------------------------- |
| `manifest` | Path to the `_manifest.json` with `{file, sha256, candidate}[]`.  |
| `count`    | Number of images successfully downloaded.                         |

## Provider auth

Expose provider keys via `env:` at the job or step level. Keys not provided
simply cause the matching provider to skip (no failure):

```yaml
env:
  UNSPLASH_ACCESS_KEY: ${{ secrets.UNSPLASH_ACCESS_KEY }}
  BRAVE_API_KEY: ${{ secrets.BRAVE_API_KEY }}
```

See `docs/PROVIDERS.md` for the full matrix.
