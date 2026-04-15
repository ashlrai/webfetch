"""Basic search example.

Usage:
    export WEBFETCH_API_KEY=wf_live_...
    python examples/basic_search.py "drake portrait"
"""
from __future__ import annotations

import os
import sys

from webfetch import WebfetchClient


def main() -> int:
    if not os.environ.get("WEBFETCH_API_KEY"):
        print("set WEBFETCH_API_KEY to run this example against api.getwebfetch.com")
        print("or pass base_url=http://127.0.0.1:7600 to WebfetchClient for self-hosted")
        return 0

    query = sys.argv[1] if len(sys.argv) > 1 else "drake portrait"
    with WebfetchClient() as client:
        res = client.search(query, license="safe-only", limit=5)
        for cand in res.candidates:
            print(f"{cand.license.value:20s} {cand.source:15s} {cand.url}")
            if cand.attribution_line:
                print(f"  attribution: {cand.attribution_line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
