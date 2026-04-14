"""webfetch - license-first image layer for AI agents and humans (Python SDK)."""
from .client import AsyncWebfetchClient, DEFAULT_BASE_URL, WebfetchClient
from .errors import AuthError, QuotaError, RateLimitError, WebfetchError
from .types import (
    ApiKey,
    DownloadResponse,
    FetchWithLicenseResponse,
    ImageCandidate,
    KeysResponse,
    License,
    ProbeResponse,
    ProviderReport,
    ProviderStatus,
    ProvidersResponse,
    SearchResponse,
    UsageResponse,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "WebfetchClient",
    "AsyncWebfetchClient",
    "DEFAULT_BASE_URL",
    "WebfetchError",
    "AuthError",
    "QuotaError",
    "RateLimitError",
    "License",
    "ImageCandidate",
    "ProviderReport",
    "ProviderStatus",
    "ProvidersResponse",
    "SearchResponse",
    "DownloadResponse",
    "ProbeResponse",
    "FetchWithLicenseResponse",
    "UsageResponse",
    "ApiKey",
    "KeysResponse",
]
