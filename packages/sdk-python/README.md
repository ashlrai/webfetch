# webfetch — Python SDK

The license-first image layer for AI agents and humans. Python bindings for
[getwebfetch.com](https://getwebfetch.com), at full parity with the TypeScript SDK
([`webfetch-core`](https://www.npmjs.com/package/webfetch-core)).

- 25 image providers with license-aware ranking
- Platform-license tags for Unsplash, Pexels, and Pixabay instead of treating them as CC0
- License-aware defaults that distinguish open, platform-license, editorial, and unknown results
- Drop-in async API via `AsyncWebfetchClient`
- Cloud calls use `/v1/*`; custom self-hosted base URLs keep the server's unversioned compatibility routes

## Install

```bash
pip install webfetch
```

Python 3.10+ required.

## Auth

Get a key at https://getwebfetch.com for cloud account methods, or use the
self-hosted token from `~/.webfetch/server.token` for a local server. Either
set an env var:

```bash
export WEBFETCH_API_KEY=wf_live_...
```

or pass it directly:

```python
from webfetch import WebfetchClient

client = WebfetchClient(api_key="wf_live_...")
```

For self-hosted (`webfetch-server`), point at your local instance:

```python
client = WebfetchClient(
    base_url="http://127.0.0.1:7600",
    api_key=open(os.path.expanduser("~/.webfetch/server.token")).read().strip(),
)
```

Default clients call cloud mode at `https://api.getwebfetch.com/v1/*`.
Supplying a custom `base_url` switches to local/self-hosted compatibility
routes such as `/search`, `/download`, and `/providers`.

## Examples

### Basic search

```python
from webfetch import WebfetchClient

with WebfetchClient() as client:
    res = client.search("drake portrait", license="safe-only", limit=10)
    for cand in res.candidates:
        print(cand.license.value, cand.url, "-", cand.attribution_line)
```

### Artist portrait

```python
res = client.search_artist_images("Taylor Swift", kind="portrait")
```

### Async batch

```python
import asyncio
from webfetch import AsyncWebfetchClient

async def main():
    async with AsyncWebfetchClient() as client:
        results = await asyncio.gather(
            client.search_artist_images("Drake"),
            client.search_artist_images("Billie Eilish"),
        )
        for r in results:
            print(r.candidates[0].url if r.candidates else "(none)")

asyncio.run(main())
```

For very large shell-oriented batches, prefer the TypeScript CLI:

```bash
printf "drake portrait\nradiohead album\n" | webfetch batch --jsonl --continue-on-error
```

### Download with attribution sidecar

```python
import json, pathlib
from webfetch import WebfetchClient

with WebfetchClient() as client:
    res = client.search("drake portrait", limit=1)
    cand = res.candidates[0]
    dl = client.download(cand.url, out_dir="./assets")
    pathlib.Path(f"./assets/{pathlib.Path(dl.cached_path).name}.json").write_text(
        json.dumps({
            "license": cand.license.value,
            "source": cand.source_page_url,
            "author": cand.author,
            "attribution": cand.attribution_line,
        }, indent=2)
    )
```

## Error handling

```python
from webfetch import AuthError, QuotaError, RateLimitError, WebfetchError

try:
    res = client.search("...")
except AuthError:
    ...  # 401 — bad or missing key
except QuotaError as e:
    print("upgrade at", e.upgrade_url)  # 402
except RateLimitError as e:
    print("retry in", e.retry_after, "s")  # 429
except WebfetchError as e:
    print(e.status, e.message)  # network or 5xx
```

## CLI

```bash
webfetch-py search "drake portrait" --limit 5
webfetch-py providers
webfetch-py download https://... --out-dir ./assets
```

`python -m webfetch ...` remains available for direct module execution. The
installed console script is `webfetch-py` so it does not shadow the canonical
TypeScript `webfetch` CLI.

## Parity with the TypeScript SDK

| Python method | HTTP endpoint | `webfetch-core` equivalent |
|---|---|---|
| `search` | `POST /v1/search` cloud, `POST /search` local | `searchImages` |
| `search_artist_images` | `POST /v1/artist` cloud, `POST /artist` local | `searchArtistImages` |
| `search_album_cover` | `POST /v1/album` cloud, `POST /album` local | `searchAlbumCover` |
| `download` | `POST /v1/download` cloud, `POST /download` local | `downloadImage` |
| `probe` | `POST /v1/probe` cloud, `POST /probe` local | `probePage` |
| `fetch_with_license` | `POST /v1/license` cloud, `POST /license` local | `fetchWithLicense` |
| `find_similar` | `POST /v1/similar` cloud, `POST /similar` local | `findSimilar` |
| `providers` | `GET /v1/providers` cloud, `GET /providers` local | `ALL_PROVIDERS` |
| `usage` | `GET /v1/usage` | cloud only |
| `keys` | `GET /v1/keys` | cloud only |

## License Migration

Older integrations may have expected Unsplash, Pexels, and Pixabay results to
deserialize as `License.CC0`. The current taxonomy uses
`License.UNSPLASH_LICENSE`, `License.PEXELS_LICENSE`, and
`License.PIXABAY_LICENSE`. Keep `license="safe-only"` if those platform terms
are acceptable; use `license="open-only"` for Creative Commons/public-domain
only workflows.

## Links

- Docs and dashboard: https://getwebfetch.com
- TypeScript SDK: https://www.npmjs.com/package/webfetch-core
- Source: https://github.com/ashlrai/webfetch

## License

MIT
