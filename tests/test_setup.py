from dataclasses import replace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from starlette.applications import Starlette
from starlette.routing import Route

from icloud_calendar_mcp.auth import OwnerJWTVerifier
from icloud_calendar_mcp.server import build_server
from icloud_calendar_mcp.service import PolicyError
from icloud_calendar_mcp.setup import SetupBridge, discover, read_private_file
from test_auth import token

pytestmark = pytest.mark.asyncio


@pytest.fixture
def guided(settings, tmp_path):
    secret = tmp_path / "secret"
    secret.write_text("test-only-private-service-secret-000000000")
    secret.chmod(0o600)
    return replace(settings, setup_url="http://web:3001", setup_secret_file=secret)


async def test_guided_server_starts_without_apple_password(guided):
    with patch("icloud_calendar_mcp.server.ICloudClient") as create_client:
        server = build_server(guided)
        assert server is not None
        create_client.assert_not_called()


async def test_bridge_failure_is_closed_and_has_no_secret(guided):
    bridge = SetupBridge(guided)
    await bridge.http.aclose()
    bridge.http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(401, json={"error": "secret-not-for-chat"})
        )
    )
    with pytest.raises(PolicyError, match="Reconnect"):
        await bridge.access("test-token")
    await bridge.close()


async def test_bridge_checks_private_service_on_every_verification(guided, signing_key):
    bridge = AsyncMock()
    public = signing_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    verifier = OwnerJWTVerifier(
        owner_subject=None,
        setup_bridge=bridge,
        public_key=public,
        algorithm="RS256",
        issuer=guided.issuer,
        audience=guided.public_url + "/mcp",
        required_scopes=["calendar:read"],
    )
    encoded = token(signing_key, guided)
    assert await verifier.verify_token(encoded)
    bridge.access.assert_awaited_once_with(encoded, check_only=True)
    bridge.access.side_effect = PolicyError("Revoked")
    assert await verifier.verify_token(encoded) is None


async def test_discovery_route_rejects_missing_internal_secret():
    async def handler(request):
        return await discover(request, "test-private-secret")

    app = Starlette(routes=[Route("/internal/discover", handler, methods=["POST"])])
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://private"
    ) as web:
        response = await web.post("/internal/discover", json={})
    assert response.status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"username": "user@example.com", "password": "main-password"},
        {"username": "user@example.com", "password": ["aaaa-bbbb-cccc-dddd"]},
        {"username": "user\n@example.com", "password": "aaaa-bbbb-cccc-dddd"},
    ],
)
async def test_discovery_rejects_invalid_credentials_before_account_request(body):
    async def handler(request):
        return await discover(request, "test-private-secret")

    app = Starlette(routes=[Route("/internal/discover", handler, methods=["POST"])])
    with patch("icloud_calendar_mcp.setup.ICloudClient") as client:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://private"
        ) as web:
            response = await web.post(
                "/internal/discover",
                json=body,
                headers={"Authorization": "Bearer test-private-secret"},
            )
        assert response.status_code == 400
        client.assert_not_called()


async def test_discovery_returns_metadata_without_credentials(client):
    client._principal.return_value = "https://caldav.icloud.com/principal/"

    async def handler(request):
        return await discover(request, "test-private-secret")

    app = Starlette(routes=[Route("/internal/discover", handler, methods=["POST"])])
    with patch("icloud_calendar_mcp.setup.ICloudClient", return_value=client):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://private"
        ) as web:
            response = await web.post(
                "/internal/discover",
                json={"username": "user@example.com", "password": "aaaa-bbbb-cccc-dddd"},
                headers={"Authorization": "Bearer test-private-secret"},
            )
    assert response.status_code == 200
    assert response.json()["calendars"][0]["id"] == "home"
    assert "aaaa-bbbb-cccc-dddd" not in response.text
    assert "user@example.com" not in response.text
    client.aclose.assert_awaited_once()


async def test_secret_file_must_be_private(tmp_path):
    file = tmp_path / "secret"
    file.write_text("test-service-secret-with-enough-characters")
    file.chmod(0o644)
    with pytest.raises(ValueError, match="protected"):
        read_private_file(file)


async def test_bridge_preserves_host_write_limit(guided, client):
    bridge = SetupBridge(guided)
    snapshot = {
        "active": True,
        "username": "owner@example.com",
        "password": "aaaa-bbbb-cccc-dddd",
        "connection_id": "connection",
        "policy": {
            "read_calendars": ["home", "work"],
            "write_calendars": ["work"],
            "write_operations": ["create", "update"],
        },
    }
    bridge.access = AsyncMock(return_value=snapshot)
    with (
        patch("icloud_calendar_mcp.setup.get_access_token") as auth,
        patch("icloud_calendar_mcp.setup.ICloudClient", return_value=client),
    ):
        auth.return_value.token = "test-token"
        with pytest.raises(PolicyError, match="not permitted"):
            await bridge.call(
                "create_event",
                calendar_id="work",
                request_id="bad-id",
                title="x",
                start="2026-10-03T12:00:00Z",
                end="2026-10-03T13:00:00Z",
            )
    client.put.assert_not_called()
    await bridge.close()


async def test_guided_discovery_uses_private_route_on_real_mcp_app(guided, client):
    client._principal.return_value = "https://caldav.icloud.com/principal/"
    server = build_server(guided)
    with patch("icloud_calendar_mcp.setup.ICloudClient", return_value=client):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(server.http_app()), base_url="http://calendar"
        ) as web:
            denied = await web.post("/internal/discover", json={})
            assert denied.status_code == 404
            response = await web.post(
                "/internal/discover",
                json={"username": "owner@example.com", "password": "aaaa-bbbb-cccc-dddd"},
                headers={"Authorization": "Bearer test-only-private-service-secret-000000000"},
            )
    assert response.status_code == 200
    assert response.json()["calendars"][0]["id"] == "home"
