"""Async batch search — fan out across many artists concurrently."""
from __future__ import annotations

import asyncio
import os

from webfetch import AsyncWebfetchClient


ARTISTS = ["Drake", "Taylor Swift", "Billie Eilish", "Kendrick Lamar"]


async def main() -> int:
    if not os.environ.get("WEBFETCH_API_KEY"):
        print("set WEBFETCH_API_KEY to run this example")
        return 0
    async with AsyncWebfetchClient() as client:
        results = await asyncio.gather(
            *(client.search_artist_images(a, kind="portrait") for a in ARTISTS)
        )
    for artist, res in zip(ARTISTS, results):
        top = res.candidates[0] if res.candidates else None
        print(f"{artist:20s} -> {top.url if top else '(no results)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
