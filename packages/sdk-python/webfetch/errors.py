"""Exception hierarchy for the webfetch SDK."""
from __future__ import annotations

from typing import Any, Optional


class WebfetchError(Exception):
    """Base error for all SDK failures (network, server 5xx, unexpected)."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.body = body

    def __repr__(self) -> str:  # pragma: no cover - trivial
        return f"{type(self).__name__}(status={self.status!r}, message={self.message!r})"


class AuthError(WebfetchError):
    """Raised on 401 - missing or invalid API key."""


class QuotaError(WebfetchError):
    """Raised on 402 - workspace quota exhausted."""

    def __init__(
        self,
        message: str,
        *,
        upgrade_url: Optional[str] = None,
        status: Optional[int] = 402,
        body: Any = None,
    ) -> None:
        super().__init__(message, status=status, body=body)
        self.upgrade_url = upgrade_url


class RateLimitError(WebfetchError):
    """Raised on 429 - too many requests."""

    def __init__(
        self,
        message: str,
        *,
        retry_after: Optional[float] = None,
        status: Optional[int] = 429,
        body: Any = None,
    ) -> None:
        super().__init__(message, status=status, body=body)
        self.retry_after = retry_after


__all__ = ["WebfetchError", "AuthError", "QuotaError", "RateLimitError"]
