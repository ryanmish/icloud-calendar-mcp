import httpx
import pytest
from fastmcp.server.auth import RemoteAuthProvider

from icloud_calendar_mcp.server import build_server

from test_auth import token
from test_policy import CREATE

pytestmark = pytest.mark.anyio


@pytest.fixture
async def transport(settings, client, verifier):
    auth = RemoteAuthProvider(
        token_verifier=verifier, authorization_servers=[settings.issuer],
        base_url=settings.public_url, scopes_supported=["calendar:read", "calendar:write"],
    )
    server = build_server(settings, client=client, auth=auth)
    app = server.http_app(stateless_http=True, json_response=True)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=settings.public_url
        ) as connection:
            yield connection


async def rpc(connection, method, *, bearer=None, params=None):
    headers = {"Accept": "application/json, text/event-stream"}
    if bearer:
        headers["Authorization"] = "Bearer " + bearer
    return await connection.post("/mcp", headers=headers, json={
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params or {},
    })


async def test_unauthenticated_mcp_denied(transport, client):
    response = await rpc(transport, "tools/list")
    assert response.status_code == 401
    assert "resource_metadata" in response.headers["www-authenticate"]
    client.calendars.assert_not_called()


async def test_discovery_is_available(transport, settings):
    response = await transport.get("/.well-known/oauth-protected-resource/mcp")
    assert response.status_code == 200
    body = response.json()
    assert body["authorization_servers"] == [settings.issuer]
    assert body["resource"] == settings.public_url + "/mcp"


async def test_other_subject_cannot_reach_calendar(transport, client, signing_key, settings):
    response = await rpc(transport, "tools/call", bearer=token(signing_key, settings, sub="other"),
                         params={"name": "list_calendars", "arguments": {}})
    assert response.status_code == 401
    client.calendars.assert_not_called()


async def test_read_token_cannot_call_write(transport, client, signing_key, settings):
    response = await rpc(
        transport, "tools/call", bearer=token(signing_key, settings, scope="calendar:read"),
        params={"name": "create_event", "arguments": CREATE},
    )
    assert response.status_code == 200
    assert response.json()["result"]["isError"] is True
    client.put.assert_not_called()


async def test_authorized_write_and_annotations(transport, client, signing_key, settings):
    bearer = token(signing_key, settings)
    tools = (await rpc(transport, "tools/list", bearer=bearer)).json()["result"]["tools"]
    indexed = {tool["name"]: tool for tool in tools}
    assert set(indexed) == {"get_profile", "list_calendars", "search_events", "get_event",
                            "create_event", "update_event"}
    assert indexed["create_event"]["annotations"]["readOnlyHint"] is False
    assert indexed["search_events"]["annotations"]["readOnlyHint"] is True
    assert indexed["get_profile"]["_meta"]["openai/profile"] is True
    response = await rpc(transport, "tools/call", bearer=bearer,
                         params={"name": "create_event", "arguments": CREATE})
    assert response.json()["result"]["isError"] is False
    client.put.assert_awaited_once()


async def test_profile_is_stable(transport, signing_key, settings):
    values = []
    for _ in range(2):
        response = await rpc(transport, "tools/call", bearer=token(signing_key, settings),
                             params={"name": "get_profile", "arguments": {}})
        values.append(response.json()["result"]["structuredContent"])
    assert values[0] == values[1]
    assert len(values[0]["id"]) == 64
