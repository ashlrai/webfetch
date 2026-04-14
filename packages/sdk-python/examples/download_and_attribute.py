"""Download an image and write an attribution sidecar (.json)."""
from __future__ import annotations

import json
import os
import pathlib
import sys

from webfetch import WebfetchClient


def main() -> int:
    if not os.environ.get("WEBFETCH_API_KEY"):
        print("set WEBFETCH_API_KEY to run this example")
        return 0
    query = sys.argv[1] if len(sys.argv) > 1 else "drake portrait"
    out_dir = pathlib.Path("./assets")
    out_dir.mkdir(parents=True, exist_ok=True)

    with WebfetchClient() as client:
        res = client.search(query, license="safe-only", limit=1)
        if not res.candidates:
            print("no candidates")
            return 1
        cand = res.candidates[0]
        dl = client.download(cand.url, out_dir=str(out_dir))
        sidecar = {
            "source": cand.source,
            "sourcePageUrl": cand.source_page_url,
            "license": cand.license.value,
            "licenseUrl": cand.license_url,
            "author": cand.author,
            "attributionLine": cand.attribution_line,
            "sha256": dl.sha256,
        }
        name = pathlib.Path(dl.cached_path).name if dl.cached_path else "image.bin"
        (out_dir / f"{name}.json").write_text(json.dumps(sidecar, indent=2))
        print(f"saved {dl.cached_path} + attribution sidecar")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
