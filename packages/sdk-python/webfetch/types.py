"""Pydantic models mirroring packages/core/src/types.ts."""
from __future__ import annotations

from enum import Enum
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class License(str, Enum):
    CC0 = "CC0"
    PUBLIC_DOMAIN = "PUBLIC_DOMAIN"
    CC_BY = "CC_BY"
    CC_BY_SA = "CC_BY_SA"
    EDITORIAL_LICENSED = "EDITORIAL_LICENSED"
    PRESS_KIT_ALLOWLIST = "PRESS_KIT_ALLOWLIST"
    UNKNOWN = "UNKNOWN"


ProviderId = Literal[
    "wikimedia",
    "openverse",
    "unsplash",
    "pexels",
    "pixabay",
    "itunes",
    "musicbrainz-caa",
    "spotify",
    "youtube-thumb",
    "brave",
    "bing",
    "serpapi",
    "browser",
    "flickr",
    "internet-archive",
    "smithsonian",
    "nasa",
    "met-museum",
    "europeana",
]

LicensePolicy = Literal["safe-only", "prefer-safe", "any"]
SafeSearchMode = Literal["strict", "moderate", "off"]


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class ImageCandidate(_Base):
    url: str
    thumbnail_url: Optional[str] = Field(default=None, alias="thumbnailUrl")
    width: Optional[int] = None
    height: Optional[int] = None
    mime: Optional[str] = None
    byte_size: Optional[int] = Field(default=None, alias="byteSize")
    source: str
    source_page_url: Optional[str] = Field(default=None, alias="sourcePageUrl")
    title: Optional[str] = None
    author: Optional[str] = None
    license: License = License.UNKNOWN
    license_url: Optional[str] = Field(default=None, alias="licenseUrl")
    attribution_line: Optional[str] = Field(default=None, alias="attributionLine")
    score: Optional[float] = None
    confidence: Optional[float] = None
    phash: Optional[str] = None
    raw: Any = None
    via_browser_fallback: Optional[bool] = Field(default=None, alias="viaBrowserFallback")


class ProviderReport(_Base):
    provider: str
    ok: bool
    count: int
    time_ms: int = Field(alias="timeMs")
    error: Optional[str] = None
    skipped: Optional[str] = None


class SearchResponse(_Base):
    candidates: List[ImageCandidate] = Field(default_factory=list)
    provider_reports: List[ProviderReport] = Field(
        default_factory=list, alias="providerReports"
    )
    warnings: List[str] = Field(default_factory=list)


class DownloadResponse(_Base):
    url: str
    sha256: str
    mime: Optional[str] = None
    byte_size: int = Field(alias="byteSize")
    cached_path: Optional[str] = Field(default=None, alias="cachedPath")


class ProbeResponse(_Base):
    url: str
    images: List[ImageCandidate] = Field(default_factory=list)
    allowed: Optional[bool] = None
    robots: Optional[Any] = None


class FetchWithLicenseResponse(_Base):
    license: License = License.UNKNOWN
    confidence: Optional[float] = None
    author: Optional[str] = None
    attribution_line: Optional[str] = Field(default=None, alias="attributionLine")
    source_page_url: Optional[str] = Field(default=None, alias="sourcePageUrl")
    mime: Optional[str] = None
    sha256: Optional[str] = None
    cached_path: Optional[str] = Field(default=None, alias="cachedPath")
    byte_size: Optional[int] = Field(default=None, alias="byteSize")


class ProviderStatus(_Base):
    id: str
    requires_auth: Optional[bool] = Field(default=None, alias="requiresAuth")
    authenticated: Optional[bool] = None
    default_license: Optional[License] = Field(default=None, alias="defaultLicense")
    opt_in: Optional[bool] = Field(default=None, alias="optIn")


class ProvidersResponse(_Base):
    all: List[str] = Field(default_factory=list)
    defaults: List[str] = Field(default_factory=list)
    endpoints: List[str] = Field(default_factory=list)
    statuses: Optional[List[ProviderStatus]] = None


class UsageResponse(_Base):
    workspace_id: Optional[str] = Field(default=None, alias="workspaceId")
    plan: Optional[str] = None
    period_start: Optional[str] = Field(default=None, alias="periodStart")
    period_end: Optional[str] = Field(default=None, alias="periodEnd")
    fetches_used: Optional[int] = Field(default=None, alias="fetchesUsed")
    fetches_quota: Optional[int] = Field(default=None, alias="fetchesQuota")
    overage_usd: Optional[float] = Field(default=None, alias="overageUsd")


class ApiKey(_Base):
    id: str
    name: Optional[str] = None
    prefix: Optional[str] = None
    created_at: Optional[str] = Field(default=None, alias="createdAt")
    last_used_at: Optional[str] = Field(default=None, alias="lastUsedAt")
    revoked: Optional[bool] = None


class KeysResponse(_Base):
    keys: List[ApiKey] = Field(default_factory=list)


__all__ = [
    "License",
    "ProviderId",
    "LicensePolicy",
    "SafeSearchMode",
    "ImageCandidate",
    "ProviderReport",
    "SearchResponse",
    "DownloadResponse",
    "ProbeResponse",
    "FetchWithLicenseResponse",
    "ProviderStatus",
    "ProvidersResponse",
    "UsageResponse",
    "ApiKey",
    "KeysResponse",
]
