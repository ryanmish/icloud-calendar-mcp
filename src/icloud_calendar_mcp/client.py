"""Restrict Apple credentials to the CalDAV hosts and bound HTTP responses."""

import logging
import re
from urllib.parse import urljoin, urlsplit

import httpx

from .vendor.caldav import CalDavClient
from .vendor.dav import AuthError, Conflict, DavError, NotFound, Throttled

MAX_RESPONSE_BYTES = 4 * 1024 * 1024
logger = logging.getLogger(__name__)


def check_icloud_url(url: str):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.port not in (None, 443)
            or parsed.username or parsed.password or parsed.fragment
            or not re.fullmatch(r"(?:p\d+-)?caldav\.icloud\.com", parsed.hostname or "")):
        raise DavError("The CalDAV response contains a prohibited destination.")


class ICloudClient(CalDavClient):
    def _http(self):
        if self._client is None:
            self._client = httpx.AsyncClient(
                auth=self._auth,
                timeout=20,
                follow_redirects=False,
                trust_env=False,
                headers={"User-Agent": "icloud-calendar-mcp/0.1"},
            )
        return self._client

    async def _request(self, method, url, *, body=None, headers=None, expect=(200, 207)):
        # No automatic retries for writes. A lost reply must not cause a
        # second invitation or an unreported second mutation.
        for _ in range(5):
            check_icloud_url(url)
            try:
                async with self._http().stream(
                    method, url, content=body.encode() if body else None, headers=headers
                ) as response:
                    chunks = []
                    size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > MAX_RESPONSE_BYTES:
                            raise DavError("The iCloud response exceeds the size limit.")
                        chunks.append(chunk)
                    content = b"".join(chunks)
                    result = httpx.Response(
                        response.status_code, headers=response.headers,
                        content=content, request=response.request,
                    )
            except httpx.HTTPError:
                raise DavError("The iCloud request failed. Read the event before retrying a write.") from None
            if result.status_code in (301, 302, 307, 308):
                if method in ("PUT", "DELETE"):
                    raise DavError("A calendar write redirect was refused.")
                url = urljoin(url, result.headers.get("Location", ""))
                continue
            if result.status_code in (401, 403):
                raise AuthError("iCloud refused account access.")
            if result.status_code in (429, 503):
                raise Throttled("iCloud is busy. Try again later.")
            if result.status_code == 404:
                raise NotFound("The calendar item does not exist.")
            if result.status_code in (409, 412):
                raise Conflict("The event changed or already exists. Read it before retrying.")
            if result.status_code not in expect:
                raise DavError("iCloud refused the calendar request.")
            return result
        raise DavError("The iCloud redirect limit was reached.")
