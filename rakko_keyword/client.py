"""Client for the Rakko Keyword API.

The API key is read from the RAKKO_API_KEY environment variable and sent via
X-API-Key as required by Rakko Keyword's API/MCP documentation.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Mapping

import requests


class RakkoKeywordError(RuntimeError):
    """Raised when the Rakko Keyword API returns an error response."""


class RakkoKeywordConfigError(RuntimeError):
    """Raised when the client is not configured correctly."""


@dataclass(frozen=True)
class RetryConfig:
    max_retries: int = 3
    backoff_factor: float = 1.0


class RakkoKeywordClient:
    """Small requests-based client for Rakko Keyword API v1."""

    BASE_URL = "https://api.rakkokeyword.com/v1"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = BASE_URL,
        timeout: float = 30.0,
        retry_config: RetryConfig | None = None,
        session: requests.Session | None = None,
        sleep: Any = time.sleep,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.environ["RAKKO_API_KEY"]
        if not self.api_key:
            raise RakkoKeywordConfigError("RAKKO_API_KEY is empty")

        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.retry_config = retry_config or RetryConfig()
        self.session = session or requests.Session()
        self._sleep = sleep

    def related_keywords(self, keyword: str, **params: Any) -> dict[str, Any]:
        """Fetch related keywords."""
        return self._post("/related-keywords", {"keyword": keyword, **params})

    def suggest_keywords(self, keyword: str, **params: Any) -> dict[str, Any]:
        """Fetch suggest keywords."""
        return self._post("/suggest-keywords", {"keyword": keyword, **params})

    def co_occurrence(self, keyword: str, **params: Any) -> dict[str, Any]:
        """Fetch co-occurrence words."""
        return self._post("/co-occurrence", {"keyword": keyword, **params})

    def other_keywords(self, keyword: str, **params: Any) -> dict[str, Any]:
        """Fetch LSI/PAA keywords/questions."""
        return self._post("/other-keywords", {"keyword": keyword, **params})

    def lsi_paa(self, keyword: str, **params: Any) -> dict[str, Any]:
        """Alias for LSI/PAA endpoint."""
        return self.other_keywords(keyword, **params)

    def headline(self, keyword: str, **params: Any) -> dict[str, Any]:
        """Fetch headline extraction results."""
        return self._post("/headline", {"keyword": keyword, **params})

    def _post(self, path: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-API-Key": self.api_key,
        }

        for attempt in range(self.retry_config.max_retries + 1):
            response = self.session.post(url, json=dict(payload), headers=headers, timeout=self.timeout)
            if response.status_code != 429:
                return self._handle_response(response)
            if attempt >= self.retry_config.max_retries:
                return self._handle_response(response)
            self._sleep(self.retry_config.backoff_factor * (2**attempt))

        raise AssertionError("unreachable")

    def _handle_response(self, response: requests.Response) -> dict[str, Any]:
        if 200 <= response.status_code < 300:
            try:
                return response.json()
            except ValueError as exc:
                raise RakkoKeywordError("Rakko Keyword API returned invalid JSON") from exc

        detail = self._format_error_detail(response)
        raise RakkoKeywordError(f"Rakko Keyword API error {response.status_code}: {detail}")

    @staticmethod
    def _format_error_detail(response: requests.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            return response.text.strip() or response.reason or "No response body"

        if isinstance(body, dict):
            errors = body.get("errors")
            if isinstance(errors, list):
                return "; ".join(str(error) for error in errors)
            if isinstance(errors, dict):
                return "; ".join(f"{key}: {value}" for key, value in errors.items())
            for key in ("message", "error", "detail"):
                if body.get(key):
                    return str(body[key])
            return str(body)
        return str(body)
