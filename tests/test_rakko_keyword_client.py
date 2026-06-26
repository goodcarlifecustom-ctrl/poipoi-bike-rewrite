import os

import pytest

from rakko_keyword import RakkoKeywordClient, RakkoKeywordError, RetryConfig


class FakeResponse:
    def __init__(self, status_code, body, text="", reason=""):
        self.status_code = status_code
        self._body = body
        self.text = text
        self.reason = reason

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.responses.pop(0)


def test_api_key_missing_raises_key_error(monkeypatch):
    monkeypatch.delenv("RAKKO_API_KEY", raising=False)

    with pytest.raises(KeyError, match="RAKKO_API_KEY"):
        RakkoKeywordClient()


def test_uses_x_api_key_header_and_endpoint(monkeypatch):
    monkeypatch.setenv("RAKKO_API_KEY", "test-key")
    session = FakeSession([FakeResponse(200, {"result": True, "data": {"items": []}})])

    result = RakkoKeywordClient(session=session).suggest_keywords("バイク", limit=10)

    assert result["result"] is True
    assert session.calls[0][0] == "https://api.rakkokeyword.com/v1/suggest-keywords"
    assert session.calls[0][1]["headers"]["X-API-Key"] == "test-key"
    assert session.calls[0][1]["json"] == {"keyword": "バイク", "limit": 10}


@pytest.mark.parametrize("status", [400, 402, 403, 500, 503])
def test_error_response_is_readable(monkeypatch, status):
    monkeypatch.setenv("RAKKO_API_KEY", "test-key")
    session = FakeSession([FakeResponse(status, {"errors": ["利用上限に達しました", "プランを確認してください"]})])

    with pytest.raises(RakkoKeywordError) as excinfo:
        RakkoKeywordClient(session=session).related_keywords("バイク")

    message = str(excinfo.value)
    assert f"{status}" in message
    assert "利用上限に達しました" in message
    assert "プランを確認してください" in message


def test_429_retries_with_exponential_backoff(monkeypatch):
    monkeypatch.setenv("RAKKO_API_KEY", "test-key")
    session = FakeSession([
        FakeResponse(429, {"errors": ["rate limited"]}),
        FakeResponse(429, {"errors": ["rate limited"]}),
        FakeResponse(200, {"result": True}),
    ])
    sleeps = []

    result = RakkoKeywordClient(
        session=session,
        retry_config=RetryConfig(max_retries=3, backoff_factor=0.5),
        sleep=sleeps.append,
    ).co_occurrence("バイク")

    assert result == {"result": True}
    assert len(session.calls) == 3
    assert sleeps == [0.5, 1.0]


@pytest.mark.skipif(not os.environ.get("RAKKO_LIVE_TEST"), reason="set RAKKO_LIVE_TEST=1 to call the real API")
def test_live_suggest_keywords():
    result = RakkoKeywordClient().suggest_keywords("バイク", limit=5)
    assert result.get("data") is not None
