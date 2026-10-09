"""Private setup bridge. Calendar credentials never become MCP inputs or outputs."""

import hmac
import json
import os
import re
import stat
from dataclasses import replace
from pathlib import Path

import httpx
from fastmcp.server.dependencies import get_access_token

from .client import ICloudClient
from .service import CalendarService, PolicyError
from .vendor.dav import AuthError


def read_private_file(path: Path) -> str:
    with path.open() as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise ValueError("The setup secret must be a protected regular file.")
        value = stream.read(4096).strip()
    if len(value) < 32:
        raise ValueError("The setup secret is too short.")
    return value


class SetupBridge:
    def __init__(self, settings):
        self.settings = settings
        self.secret = read_private_file(settings.setup_secret_file)
        self.http = httpx.AsyncClient(timeout=10, trust_env=False, follow_redirects=False)

    async def access(self, token: str, *, check_only=False):
        try:
            response = await self.http.post(
                self.settings.setup_url.rstrip("/") + "/internal/access",
                headers={"Authorization": "Bearer " + self.secret},
                json={"token": token, "check_only": check_only},
            )
            if response.status_code != 200 or len(response.content) > 64 * 1024:
                raise ValueError
            result = response.json()
            if not isinstance(result, dict) or result.get("active") is not True:
                raise ValueError
            return result
        except (httpx.HTTPError, ValueError, TypeError):
            raise PolicyError(
                "This connection is not available. Reconnect through the setup page."
            ) from None

    async def call(self, operation, **kwargs):
        token = get_access_token()
        if token is None:
            raise PolicyError("Authentication is required.")
        snapshot = await self.access(token.token)
        if operation == "profile":
            return snapshot["profile_id"]
        policy = snapshot["policy"]
        host = self.settings
        readable = frozenset(policy["read_calendars"])
        writable = frozenset(policy["write_calendars"]) & host.write_calendars
        if "*" not in host.read_calendars:
            readable &= host.read_calendars
        writable &= readable
        settings = replace(
            host,
            apple_id=snapshot["username"],
            read_calendars=readable,
            write_calendars=writable,
            write_operations=frozenset(policy["write_operations"]) & host.write_operations
            if writable
            else frozenset(),
        )
        client = ICloudClient(username=snapshot["username"], password=snapshot["password"])
        try:
            return await getattr(CalendarService(settings, client), operation)(**kwargs)
        except AuthError:
            # A calendar auth failure suspends grants. Do not treat an outage as revocation.
            try:
                await self.http.post(
                    host.setup_url.rstrip("/") + "/internal/repair",
                    headers={"Authorization": "Bearer " + self.secret},
                    json={"connection_id": snapshot["connection_id"]},
                )
            except httpx.HTTPError:
                pass
            raise
        finally:
            await client.aclose()

    async def close(self):
        await self.http.aclose()


async def discover(request, secret: str):
    """Only the web service can use this route. It never writes calendar events."""
    from starlette.responses import JSONResponse

    if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + secret):
        return JSONResponse({"error": "Not found"}, status_code=404)
    if (
        len(secret) < 16
        or not request.headers.get("content-length", "0").isdigit()
        or int(request.headers.get("content-length", "0")) > 16384
    ):
        return JSONResponse({"error": "Invalid setup input"}, status_code=400)
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > 16384:
            return JSONResponse({"error": "Invalid setup input"}, status_code=400)
    try:
        body = json.loads(chunks)
        username, password = body["username"], body["password"]
        if (
            not isinstance(username, str)
            or not 3 <= len(username) <= 254
            or "@" not in username
            or any(ord(c) < 32 for c in username)
            or not isinstance(password, str)
            or not re.fullmatch(r"[a-z]{4}(?:-[a-z]{4}){3}", password)
        ):
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return JSONResponse(
            {"error": "Enter the iCloud address and an app-specific password."}, status_code=400
        )
    client = ICloudClient(username=username, password=password)
    try:
        principal = await client._principal()
        calendars = await client.calendars()
        return JSONResponse(
            {
                "principal": principal,
                "calendars": [
                    {"id": cal.id, "name": cal.name, "read_only": cal.read_only}
                    for cal in calendars
                ],
            }
        )
    except Exception:
        return JSONResponse(
            {"error": "iCloud connection could not be verified. Check the details or try later."},
            status_code=400,
        )
    finally:
        await client.aclose()
