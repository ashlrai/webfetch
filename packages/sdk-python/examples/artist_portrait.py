"""Fetch a single artist portrait, safe-license only."""
from __future__ import annotations

import os
import sys

from webfetch import License, WebfetchClient

SAFE = {License.CC0, License.PUBLIC_DOMAIN, License.CC_BY, License.CC_BY_SA}


def main() -> int:
    if not os.environ.get("WEBFETCH_API_KEY"):
        print("set WEBFETCH_API_KEY to run this example")
        return 0
    artist = sys.argv[1] if len(sys.argv) > 1 else "Drake"
    with WebfetchClient() as client:
        res = client.search_artist_images(artist, kind="portrait")
        safe = [c for c in res.candidates if c.license in SAFE]
        if not safe:
            print(f"no safe-license portrait found for {artist}")
            return 1
        best = safe[0]
        print(f"best: {best.url}")
        print(f"license: {best.license.value}")
        print(f"attribution: {best.attribution_line or best.author or '(none)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
