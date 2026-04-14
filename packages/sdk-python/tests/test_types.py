"""Pydantic model validation tests."""
from __future__ import annotations

import json
import pathlib

import pytest
from pydantic import ValidationError

from webfetch.types import (
    ImageCandidate,
    License,
    ProviderReport,
    SearchResponse,
)

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "search_response.json"


def test_license_enum_values():
    assert License.CC0.value == "CC0"
    assert License("UNKNOWN") is License.UNKNOWN


def test_image_candidate_alias_parsing():
    cand = ImageCandidate.model_validate(
        {
            "url": "https://example.com/a.jpg",
            "thumbnailUrl": "https://example.com/a_t.jpg",
            "byteSize": 1024,
            "source": "wikimedia",
            "sourcePageUrl": "https://example.com/page",
            "license": "CC_BY",
            "licenseUrl": "https://cc/by",
            "attributionLine": "foo",
            "viaBrowserFallback": False,
        }
    )
    assert cand.thumbnail_url == "https://example.com/a_t.jpg"
    assert cand.byte_size == 1024
    assert cand.source_page_url == "https://example.com/page"
    assert cand.license is License.CC_BY
    assert cand.via_browser_fallback is False


def test_image_candidate_defaults_unknown_license():
    cand = ImageCandidate.model_validate({"url": "u", "source": "x"})
    assert cand.license is License.UNKNOWN


def test_image_candidate_rejects_invalid_license():
    with pytest.raises(ValidationError):
        ImageCandidate.model_validate(
            {"url": "u", "source": "x", "license": "NOT_A_LICENSE"}
        )


def test_image_candidate_requires_url_and_source():
    with pytest.raises(ValidationError):
        ImageCandidate.model_validate({"source": "x"})
    with pytest.raises(ValidationError):
        ImageCandidate.model_validate({"url": "u"})


def test_provider_report_time_ms_alias():
    pr = ProviderReport.model_validate(
        {"provider": "wikimedia", "ok": True, "count": 3, "timeMs": 200}
    )
    assert pr.time_ms == 200


def test_search_response_from_fixture():
    raw = json.loads(FIXTURE.read_text())
    res = SearchResponse.model_validate(raw["data"])
    assert len(res.candidates) == 2
    assert res.candidates[0].license is License.CC_BY_SA
    assert res.candidates[0].thumbnail_url.endswith("_thumb.jpg")
    assert res.provider_reports[0].provider == "wikimedia"
    assert res.warnings == []
