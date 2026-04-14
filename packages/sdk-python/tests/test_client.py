"""HTTP client tests using respx to mock httpx."""
from __future__ import annotations

import json
import pathlib

import httpx
import pytest
import respx

from webfetch import (
    AsyncWebfetchClient,
    AuthError,
    License,
    QuotaError,
    RateLimitError,
    WebfetchClient,
    WebfetchError,
)

BASE = "https://api.webfetch.dev"
FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "search_response.json"
SEARCH_FIXTURE = json.loads(FIXTURE.read_text())


def _client() -> WebfetchClient:
    return WebfetchClient(api_key="wf_test_key", base_url=BASE)


@respx.mock
def test_search_sync_happy_path():
    route = respx.post(f"{BASE}/search").mock(
        return_value=httpx.Response(200, json=SEARCH_FIXTURE)
    )
    with _client() as c:
        res = c.search("drake portrait", providers=["wikimedia"], limit=5)
    assert route.called
    req = route.calls.last.request
    body = json.loads(req.content)
    assert body["query"] == "drake portrait"
    assert body["providers"] == ["wikimedia"]
    assert body["licensePolicy"] == "safe-only"
    assert body["maxPerProvider"] == 5
    assert req.headers["authorization"] == "Bearer wf_test_key"
    assert len(res.candidates) == 2
    assert res.candidates[0].license is License.CC_BY_SA


@respx.mock
def test_search_artist_images():
    respx.post(f"{BASE}/artist").mock(
        return_value=httpx.Response(200, json=SEARCH_FIXTURE)
    )
    with _client() as c:
        res = c.search_artist_images("Drake", kind="portrait")
    assert len(res.candidates) == 2


@respx.mock
def test_search_album_cover():
    respx.post(f"{BASE}/album").mock(
        return_value=httpx.Response(200, json=SEARCH_FIXTURE)
    )
    with _client() as c:
        res = c.search_album_cover("Drake", "Scorpion")
    assert res.candidates


@respx.mock
def test_download_returns_model():
    respx.post(f"{BASE}/download").mock(
        return_value=httpx.Response(
            200,
            json={
                "ok": True,
                "data": {
                    "url": "https://x/a.jpg",
                    "sha256": "deadbeef",
                    "mime": "image/jpeg",
                    "byteSize": 2048,
                    "cachedPath": "/tmp/a.jpg",
                },
            },
        )
    )
    with _client() as c:
        res = c.download("https://x/a.jpg", max_bytes=10_000)
    assert res.sha256 == "deadbeef"
    assert res.byte_size == 2048
    assert res.cached_path == "/tmp/a.jpg"


@respx.mock
def test_probe():
    respx.post(f"{BASE}/probe").mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "data": {"url": "https://x", "images": [], "allowed": True}},
        )
    )
    with _client() as c:
        res = c.probe("https://x")
    assert res.allowed is True


@respx.mock
def test_fetch_with_license():
    respx.post(f"{BASE}/license").mock(
        return_value=httpx.Response(
            200,
            json={
                "ok": True,
                "data": {
                    "license": "CC_BY",
                    "confidence": 0.9,
                    "author": "Jane",
                    "attributionLine": "Jane, CC BY 4.0",
                    "sourcePageUrl": "https://x/p",
                    "mime": "image/jpeg",
                    "sha256": "abc",
                    "byteSize": 123,
                },
            },
        )
    )
    with _client() as c:
        res = c.fetch_with_license("https://x/img.jpg", probe=True)
    assert res.license is License.CC_BY
    assert res.author == "Jane"
    assert res.byte_size == 123


@respx.mock
def test_find_similar():
    respx.post(f"{BASE}/similar").mock(
        return_value=httpx.Response(
            200,
            json={
                "ok": True,
                "data": [
                    {"url": "https://x/1.jpg", "source": "wikimedia", "license": "CC0"}
                ],
            },
        )
    )
    with _client() as c:
        res = c.find_similar("https://x/ref.jpg")
    assert len(res) == 1
    assert res[0].license is License.CC0


@respx.mock
def test_providers_get():
    respx.get(f"{BASE}/providers").mock(
        return_value=httpx.Response(
            200,
            json={
                "ok": True,
                "data": {
                    "all": ["wikimedia", "openverse"],
                    "defaults": ["wikimedia"],
                    "endpoints": ["/search"],
                },
            },
        )
    )
    with _client() as c:
        res = c.providers()
    assert "wikimedia" in res.all


@respx.mock
def test_auth_error_on_401():
    respx.post(f"{BASE}/search").mock(
        return_value=httpx.Response(401, json={"ok": False, "error": "bad key"})
    )
    with _client() as c, pytest.raises(AuthError) as exc_info:
        c.search("x")
    assert exc_info.value.status == 401


@respx.mock
def test_quota_error_on_402_with_upgrade_url():
    respx.post(f"{BASE}/search").mock(
        return_value=httpx.Response(
            402,
            json={
                "ok": False,
                "error": "quota exhausted",
                "upgrade_url": "https://webfetch.dev/pricing",
            },
        )
    )
    with _client() as c, pytest.raises(QuotaError) as exc_info:
        c.search("x")
    assert exc_info.value.upgrade_url == "https://webfetch.dev/pricing"


@respx.mock
def test_rate_limit_error_on_429_with_retry_after():
    respx.post(f"{BASE}/search").mock(
        return_value=httpx.Response(
            429,
            headers={"retry-after": "12"},
            json={"ok": False, "error": "slow down"},
        )
    )
    with _client() as c, pytest.raises(RateLimitError) as exc_info:
        c.search("x")
    assert exc_info.value.retry_after == 12.0


@respx.mock
def test_500_raises_webfetch_error():
    respx.post(f"{BASE}/search").mock(
        return_value=httpx.Response(500, json={"ok": False, "error": "boom"})
    )
    with _client() as c, pytest.raises(WebfetchError) as exc_info:
        c.search("x")
    assert exc_info.value.status == 500


@respx.mock
def test_network_error_wrapped():
    respx.post(f"{BASE}/search").mock(side_effect=httpx.ConnectError("no net"))
    with _client() as c, pytest.raises(WebfetchError):
        c.search("x")


def test_api_key_from_env(monkeypatch):
    monkeypatch.setenv("WEBFETCH_API_KEY", "wf_from_env")
    c = WebfetchClient(base_url=BASE)
    try:
        assert c.api_key == "wf_from_env"
    finally:
        c.close()


# --- async ---------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_async_search_happy_path():
    respx.post(f"{BASE}/search").mock(
        return_value=httpx.Response(200, json=SEARCH_FIXTURE)
    )
    async with AsyncWebfetchClient(api_key="wf_test", base_url=BASE) as c:
        res = await c.search("drake")
    assert len(res.candidates) == 2


@respx.mock
@pytest.mark.asyncio
async def test_async_download():
    respx.post(f"{BASE}/download").mock(
        return_value=httpx.Response(
            200,
            json={
                "ok": True,
                "data": {
                    "url": "https://x/a.jpg",
                    "sha256": "beef",
                    "byteSize": 1,
                },
            },
        )
    )
    async with AsyncWebfetchClient(api_key="wf_test", base_url=BASE) as c:
        res = await c.download("https://x/a.jpg")
    assert res.sha256 == "beef"


@respx.mock
@pytest.mark.asyncio
async def test_async_auth_error():
    respx.post(f"{BASE}/search").mock(
        return_value=httpx.Response(401, json={"ok": False, "error": "nope"})
    )
    async with AsyncWebfetchClient(api_key="wf_test", base_url=BASE) as c:
        with pytest.raises(AuthError):
            await c.search("x")
