# webfetch — Python SDK

The license-first image layer for AI agents and humans. Python bindings for
[webfetch.dev](https://webfetch.dev), at full parity with the TypeScript SDK
([`@webfetch/core`](https://www.npmjs.com/package/@webfetch/core)).

- 19 image providers with license-aware ranking
- Safe-license defaults (CC0, Public Domain, CC-BY, CC-BY-SA) out of the box
- Drop-in async API via `AsyncWebfetchClient`
- Works against hosted cloud or your self-hosted server

## Install

```bash
pip install webfetch
```

Python 3.10+ required.

## Auth

Get a key at https://webfetch.dev. Either set an env var:

```bash
export WEBFETCH_API_KEY=wf_live_...
```

or pass it directly:

```python
from webfetch import WebfetchClient

client = WebfetchClient(api_key="wf_live_...")
```

For self-hosted (`@webfetch/server`), point at your local instance:

```python
client = WebfetchClient(
    base_url="http://127.0.0.1:7600",
    api_key=open(os.path.expanduser("~/.webfetch/server.token")).read().strip(),
)
```

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
python -m webfetch search "drake portrait" --limit 5
python -m webfetch providers
python -m webfetch download https://... --out-dir ./assets
```

## Parity with the TypeScript SDK

| Python method | HTTP endpoint | `@webfetch/core` equivalent |
|---|---|---|
| `search` | `POST /search` | `searchImages` |
| `search_artist_images` | `POST /artist` | `searchArtistImages` |
| `search_album_cover` | `POST /album` | `searchAlbumCover` |
| `download` | `POST /download` | `downloadImage` |
| `probe` | `POST /probe` | `probePage` |
| `fetch_with_license` | `POST /license` | `fetchWithLicense` |
| `find_similar` | `POST /similar` | `findSimilar` |
| `providers` | `GET /providers` | `ALL_PROVIDERS` |
| `usage` | `GET /v1/usage` | cloud only |
| `keys` | `GET /v1/keys` | cloud only |

## Links

- Docs and dashboard: https://webfetch.dev
- TypeScript SDK: https://www.npmjs.com/package/@webfetch/core
- Source: https://github.com/ashlr-ai/webfetch

## License

MIT
