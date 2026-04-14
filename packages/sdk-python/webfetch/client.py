"""Sync and async HTTP clients for the webfetch REST API.

Mirrors the endpoints defined in packages/server/src/routes.ts and the cloud
Workers. Responses are unwrapped from the `{ok, data}` envelope and coerced
into Pydantic models defined in `webfetch.types`.
"""
from __future__ import annotations

import os
import pathlib
from contextlib import AbstractAsyncContextManager, AbstractContextManager
from typing import Any, Dict, List, Optional, Sequence, Type, TypeVar

import httpx
from pydantic import BaseModel

from .errors import AuthError, QuotaError, RateLimitError, WebfetchError
from .types import (
    DownloadResponse,
    FetchWithLicenseResponse,
    ImageCandidate,
    KeysResponse,
    License,
    ProbeResponse,
    ProvidersResponse,
    SearchResponse,
    UsageResponse,
)

DEFAULT_BASE_URL = "https://api.webfetch.dev"
USER_AGENT = "webfetch-python/0.1.0"
DEFAULT_TIMEOUT = 30.0

T = TypeVar("T", bound=BaseModel)


def _resolve_api_key(api_key: Optional[str]) -> Optional[str]:
    if api_key:
        return api_key
    return os.environ.get("WEBFETCH_API_KEY")


def _headers(api_key: Optional[str]) -> Dict[str, str]:
    h = {"user-agent": USER_AGENT, "accept": "application/json"}
    if api_key:
        h["authorization"] = f"Bearer {api_key}"
    return h


def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code < 400:
        return
    try:
        body: Any = resp.json()
    except Exception:
        body = resp.text
    message = ""
    upgrade_url: Optional[str] = None
    if isinstance(body, dict):
        message = str(body.get("error") or body.get("message") or resp.text or "")
        upgrade_url = body.get("upgrade_url") or body.get("upgradeUrl")
    else:
        message = str(body or resp.text or "")

    status = resp.status_code
    if status == 401:
        raise AuthError(message or "unauthorized", status=status, body=body)
    if status == 402:
        raise QuotaError(
            message or "quota exhausted",
            upgrade_url=upgrade_url,
            status=status,
            body=body,
        )
    if status == 429:
        retry_after: Optional[float] = None
        ra = resp.headers.get("retry-after")
        if ra is not None:
            try:
                retry_after = float(ra)
            except ValueError:
                retry_after = None
        raise RateLimitError(
            message or "rate limited",
            retry_after=retry_after,
            status=status,
            body=body,
        )
    raise WebfetchError(
        message or f"http {status}", status=status, body=body
    )


def _unwrap(resp: httpx.Response) -> Any:
    try:
        payload = resp.json()
    except Exception as exc:
        raise WebfetchError(
            f"invalid JSON response: {exc}",
            status=resp.status_code,
            body=resp.text,
        )
    if isinstance(payload, dict) and "ok" in payload:
        if not payload.get("ok"):
            raise WebfetchError(
                str(payload.get("error") or "unknown error"),
                status=resp.status_code,
                body=payload,
            )
        return payload.get("data")
    return payload


def _model(cls: Type[T], data: Any) -> T:
    if data is None:
        data = {}
    return cls.model_validate(data)


def _search_payload(
    query: str,
    *,
    providers: Optional[Sequence[str]],
    license_policy: str,
    limit: int,
    min_width: int,
    min_height: int,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "query": query,
        "licensePolicy": license_policy,
        "maxPerProvider": limit,
    }
    if providers:
        body["providers"] = list(providers)
    if min_width:
        body["minWidth"] = min_width
    if min_height:
        body["minHeight"] = min_height
    return body


def _guess_filename(url: str) -> str:
    from urllib.parse import urlparse

    p = urlparse(url)
    name = pathlib.Path(p.path).name or "image.bin"
    return name


class _ClientBase:
    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self.api_key = _resolve_api_key(api_key)
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout


class WebfetchClient(_ClientBase, AbstractContextManager["WebfetchClient"]):
    """Synchronous client. Safe to use as a context manager or standalone."""

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout)
        self._http = httpx.Client(
            base_url=self.base_url,
            headers=_headers(self.api_key),
            timeout=self.timeout,
            transport=transport,
        )

    def __enter__(self) -> "WebfetchClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    # --- internal ---------------------------------------------------------
    def _post(self, path: str, body: Dict[str, Any]) -> Any:
        try:
            resp = self._http.post(path, json=body)
        except httpx.HTTPError as exc:
            raise WebfetchError(f"network error: {exc}") from exc
        _raise_for_status(resp)
        return _unwrap(resp)

    def _get(self, path: str) -> Any:
        try:
            resp = self._http.get(path)
        except httpx.HTTPError as exc:
            raise WebfetchError(f"network error: {exc}") from exc
        _raise_for_status(resp)
        return _unwrap(resp)

    # --- public API -------------------------------------------------------
    def search(
        self,
        query: str,
        *,
        providers: Optional[Sequence[str]] = None,
        license: str = "safe-only",
        limit: int = 10,
        min_width: int = 0,
        min_height: int = 0,
    ) -> SearchResponse:
        data = self._post(
            "/search",
            _search_payload(
                query,
                providers=providers,
                license_policy=license,
                limit=limit,
                min_width=min_width,
                min_height=min_height,
            ),
        )
        return _model(SearchResponse, data)

    def search_artist_images(
        self, artist: str, *, kind: str = "portrait"
    ) -> SearchResponse:
        data = self._post("/artist", {"artist": artist, "kind": kind})
        return _model(SearchResponse, data)

    def search_album_cover(self, artist: str, album: str) -> SearchResponse:
        data = self._post("/album", {"artist": artist, "album": album})
        return _model(SearchResponse, data)

    def download(
        self,
        url: str,
        *,
        out_dir: Optional[str] = None,
        max_bytes: Optional[int] = None,
    ) -> DownloadResponse:
        body: Dict[str, Any] = {"url": url}
        if max_bytes is not None:
            body["maxBytes"] = max_bytes
        if out_dir is not None:
            body["cacheDir"] = out_dir
        data = self._post("/download", body)
        resp = _model(DownloadResponse, data)
        if out_dir and not resp.cached_path:
            # Server didn't cache; fetch bytes directly and write locally.
            target_dir = pathlib.Path(out_dir).expanduser()
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / _guess_filename(url)
            try:
                raw = self._http.get(url)
                raw.raise_for_status()
                target.write_bytes(raw.content)
                resp = resp.model_copy(update={"cached_path": str(target)})
            except httpx.HTTPError:
                pass
        return resp

    def probe(self, url: str) -> ProbeResponse:
        data = self._post("/probe", {"url": url})
        return _model(ProbeResponse, data)

    def fetch_with_license(
        self, url: str, *, probe: bool = False
    ) -> FetchWithLicenseResponse:
        data = self._post("/license", {"url": url, "probe": probe})
        return _model(FetchWithLicenseResponse, data)

    def find_similar(self, url: str) -> List[ImageCandidate]:
        data = self._post("/similar", {"url": url})
        if isinstance(data, dict) and "candidates" in data:
            data = data["candidates"]
        return [ImageCandidate.model_validate(x) for x in (data or [])]

    def providers(self) -> ProvidersResponse:
        data = self._get("/providers")
        return _model(ProvidersResponse, data)

    def usage(self) -> UsageResponse:
        data = self._get("/v1/usage")
        return _model(UsageResponse, data)

    def keys(self) -> KeysResponse:
        data = self._get("/v1/keys")
        return _model(KeysResponse, data)


class AsyncWebfetchClient(_ClientBase, AbstractAsyncContextManager["AsyncWebfetchClient"]):
    """Asynchronous client backed by httpx.AsyncClient."""

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout)
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            headers=_headers(self.api_key),
            timeout=self.timeout,
            transport=transport,
        )

    async def __aenter__(self) -> "AsyncWebfetchClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._http.aclose()

    async def _post(self, path: str, body: Dict[str, Any]) -> Any:
        try:
            resp = await self._http.post(path, json=body)
        except httpx.HTTPError as exc:
            raise WebfetchError(f"network error: {exc}") from exc
        _raise_for_status(resp)
        return _unwrap(resp)

    async def _get(self, path: str) -> Any:
        try:
            resp = await self._http.get(path)
        except httpx.HTTPError as exc:
            raise WebfetchError(f"network error: {exc}") from exc
        _raise_for_status(resp)
        return _unwrap(resp)

    async def search(
        self,
        query: str,
        *,
        providers: Optional[Sequence[str]] = None,
        license: str = "safe-only",
        limit: int = 10,
        min_width: int = 0,
        min_height: int = 0,
    ) -> SearchResponse:
        data = await self._post(
            "/search",
            _search_payload(
                query,
                providers=providers,
                license_policy=license,
                limit=limit,
                min_width=min_width,
                min_height=min_height,
            ),
        )
        return _model(SearchResponse, data)

    async def search_artist_images(
        self, artist: str, *, kind: str = "portrait"
    ) -> SearchResponse:
        data = await self._post("/artist", {"artist": artist, "kind": kind})
        return _model(SearchResponse, data)

    async def search_album_cover(self, artist: str, album: str) -> SearchResponse:
        data = await self._post("/album", {"artist": artist, "album": album})
        return _model(SearchResponse, data)

    async def download(
        self,
        url: str,
        *,
        out_dir: Optional[str] = None,
        max_bytes: Optional[int] = None,
    ) -> DownloadResponse:
        body: Dict[str, Any] = {"url": url}
        if max_bytes is not None:
            body["maxBytes"] = max_bytes
        if out_dir is not None:
            body["cacheDir"] = out_dir
        data = await self._post("/download", body)
        resp = _model(DownloadResponse, data)
        if out_dir and not resp.cached_path:
            target_dir = pathlib.Path(out_dir).expanduser()
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / _guess_filename(url)
            try:
                raw = await self._http.get(url)
                raw.raise_for_status()
                target.write_bytes(raw.content)
                resp = resp.model_copy(update={"cached_path": str(target)})
            except httpx.HTTPError:
                pass
        return resp

    async def probe(self, url: str) -> ProbeResponse:
        data = await self._post("/probe", {"url": url})
        return _model(ProbeResponse, data)

    async def fetch_with_license(
        self, url: str, *, probe: bool = False
    ) -> FetchWithLicenseResponse:
        data = await self._post("/license", {"url": url, "probe": probe})
        return _model(FetchWithLicenseResponse, data)

    async def find_similar(self, url: str) -> List[ImageCandidate]:
        data = await self._post("/similar", {"url": url})
        if isinstance(data, dict) and "candidates" in data:
            data = data["candidates"]
        return [ImageCandidate.model_validate(x) for x in (data or [])]

    async def providers(self) -> ProvidersResponse:
        data = await self._get("/providers")
        return _model(ProvidersResponse, data)

    async def usage(self) -> UsageResponse:
        data = await self._get("/v1/usage")
        return _model(UsageResponse, data)

    async def keys(self) -> KeysResponse:
        data = await self._get("/v1/keys")
        return _model(KeysResponse, data)


__all__ = [
    "WebfetchClient",
    "AsyncWebfetchClient",
    "DEFAULT_BASE_URL",
]
