import httpx
import pytest

from icloud_calendar_mcp.client import ICloudClient, check_icloud_url
from icloud_calendar_mcp.vendor.dav import DavError

@pytest.mark.parametrize("url", [
    "http://caldav.icloud.com", "https://icloud.com", "https://evil.example.com",
    "https://caldav.icloud.com.evil.example.com", "https://user@caldav.icloud.com",
    "https://caldav.icloud.com:444", "https://127.0.0.1", "https://caldav.icloud.com/#x",
])
def test_credential_destinations_restricted(url):
    with pytest.raises(DavError):
        check_icloud_url(url)


@pytest.mark.parametrize("url", ["https://caldav.icloud.com/", "https://p64-caldav.icloud.com/"])
def test_apple_shards_allowed(url):
    check_icloud_url(url)


@pytest.mark.asyncio
async def test_redirect_cannot_leak_credentials(respx_mock):
    route = respx_mock.get("https://caldav.icloud.com/").mock(
        return_value=httpx.Response(302, headers={"Location": "https://evil.example.com/"})
    )
    client = ICloudClient(username="fake", password="fake")
    try:
        with pytest.raises(DavError):
            await client._request("GET", "https://caldav.icloud.com/")
        assert route.call_count == 1
        assert len(respx_mock.calls) == 1
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_large_response_denied(respx_mock, monkeypatch):
    monkeypatch.setattr("icloud_calendar_mcp.client.MAX_RESPONSE_BYTES", 32)
    respx_mock.get("https://caldav.icloud.com/").mock(return_value=httpx.Response(200, content=b"x" * 33))
    client = ICloudClient(username="fake", password="fake")
    try:
        with pytest.raises(DavError):
            await client._request("GET", "https://caldav.icloud.com/")
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_write_is_not_retried(respx_mock):
    route = respx_mock.put("https://caldav.icloud.com/event.ics").mock(
        side_effect=httpx.ReadTimeout("private-account-url")
    )
    client = ICloudClient(username="fake", password="fake")
    try:
        with pytest.raises(DavError) as error:
            await client._request("PUT", "https://caldav.icloud.com/event.ics", body="data")
        assert route.call_count == 1
        assert "private-account-url" not in str(error.value)
    finally:
        await client.aclose()
