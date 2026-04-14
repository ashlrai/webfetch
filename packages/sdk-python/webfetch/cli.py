"""Minimal CLI wrapper: `python -m webfetch <cmd>`.

Supports: search, providers, download. Kept intentionally thin; for full
features use the TypeScript CLI (`npm i -g @webfetch/cli`).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List, Optional, Sequence

from .client import WebfetchClient
from .errors import WebfetchError


def _print(obj: object) -> None:
    if hasattr(obj, "model_dump"):
        obj = obj.model_dump(by_alias=True, exclude_none=True)
    print(json.dumps(obj, indent=2, default=str))


def _client(args: argparse.Namespace) -> WebfetchClient:
    api_key = args.api_key or os.environ.get("WEBFETCH_API_KEY")
    if not api_key and not args.base_url:
        print(
            "warning: no WEBFETCH_API_KEY set; requests to api.webfetch.dev will fail. "
            "Set WEBFETCH_API_KEY or pass --base-url for self-hosted.",
            file=sys.stderr,
        )
    return WebfetchClient(api_key=api_key, base_url=args.base_url)


def _cmd_search(args: argparse.Namespace) -> int:
    with _client(args) as c:
        providers: Optional[List[str]] = args.providers.split(",") if args.providers else None
        res = c.search(
            args.query,
            providers=providers,
            license=args.license,
            limit=args.limit,
            min_width=args.min_width,
            min_height=args.min_height,
        )
        _print(res)
    return 0


def _cmd_providers(args: argparse.Namespace) -> int:
    with _client(args) as c:
        _print(c.providers())
    return 0


def _cmd_download(args: argparse.Namespace) -> int:
    with _client(args) as c:
        res = c.download(args.url, out_dir=args.out_dir, max_bytes=args.max_bytes)
        _print(res)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="webfetch", description="webfetch Python SDK CLI"
    )
    p.add_argument("--api-key", default=None, help="API key (defaults to $WEBFETCH_API_KEY)")
    p.add_argument("--base-url", default=None, help="Override API base URL (self-hosted)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="Search images")
    s.add_argument("query")
    s.add_argument("--providers", default=None, help="Comma-separated provider ids")
    s.add_argument("--license", default="safe-only", choices=["safe-only", "prefer-safe", "any"])
    s.add_argument("--limit", type=int, default=10)
    s.add_argument("--min-width", type=int, default=0)
    s.add_argument("--min-height", type=int, default=0)
    s.set_defaults(func=_cmd_search)

    pv = sub.add_parser("providers", help="List providers")
    pv.set_defaults(func=_cmd_providers)

    d = sub.add_parser("download", help="Download an image")
    d.add_argument("url")
    d.add_argument("--out-dir", default=None)
    d.add_argument("--max-bytes", type=int, default=None)
    d.set_defaults(func=_cmd_download)

    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except WebfetchError as exc:
        print(f"error: {exc.message} (status={exc.status})", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
