import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decodeJwt } from "jose";
import { fixture } from "./helpers.js";
import { verifyOAuthQueryParams } from "../src/oauth-query.js";
const PASSWORD = "aaaa-bbbb-cccc-dddd";
test("real provider: setup, PKCE exchange, access checks, refresh, and immediate revocation", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.auth.api.getSession({
          headers: new Headers({ Cookie: f.cookies }),
        })
      )?.user.id,
      f.user.id,
    );
    const client = await f.auth.api.adminCreateOAuthClient({
      headers: new Headers({ Cookie: f.cookies }),
      body: {
        client_id: "test-chatgpt",
        client_name: "Test ChatGPT",
        redirect_uris: [
          "https://chatgpt.com/connector_platform_oauth_redirect",
        ],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        scope: "calendar:read calendar:write offline_access",
        resources: [f.config.origin + "/mcp"],
      },
    });
    assert.ok(client.client_id);
    const verifier =
      "test-pkce-verifier-0123456789012345678901234567890123456789";
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      response_type: "code",
      scope: "calendar:read calendar:write offline_access",
      state: "test-state",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource: f.config.origin + "/mcp",
    });
    let response = await f.app.handle(
      f.request("/api/auth/oauth2/authorize?" + query),
    );
    assert.equal(response.status, 302, await response.clone().text());
    let next = new URL(response.headers.get("location")!, f.config.origin);
    assert.equal(next.pathname, "/setup");
    let signed = next.search.slice(1);
    assert.ok(await verifyOAuthQueryParams(signed, f.config.authSecret));
    let html = await (await f.app.handle(f.request("/setup?" + signed))).text();
    assert.match(html, /value="actual@example.com"/);
    assert.doesNotMatch(html, /relay@privaterelay/);
    response = await f.app.handle(
      f.request("/connect", {
        oauth_query: signed,
        username: "actual@example.com",
        password: PASSWORD,
        link: "yes",
      }),
    );
    assert.equal(response.status, 303, await response.clone().text());
    assert.equal(f.store.connection()?.status, "connected");
    response = await f.app.handle(
      f.request("/permissions", {
        oauth_query: signed,
        read: ["work"],
        write: ["work"],
        operation: ["create"],
      }),
    );
    assert.equal(response.status, 303, await response.clone().text());
    next = new URL(response.headers.get("location")!, f.config.origin);
    assert.equal(next.pathname, "/consent");
    signed = next.search.slice(1);
    html = await (await f.app.handle(f.request("/consent?" + signed))).text();
    assert.match(html, /Approve and return/);
    assert.doesNotMatch(html, new RegExp(PASSWORD));
    response = await f.app.handle(
      f.request("/approve", { oauth_query: signed, accept: "yes" }),
    );
    assert.equal(response.status, 303, await response.clone().text());
    next = new URL(response.headers.get("location")!, f.config.origin);
    assert.equal(next.hostname, "chatgpt.com");
    assert.equal(next.searchParams.get("state"), "test-state");
    const code = next.searchParams.get("code");
    assert.ok(code);
    async function exchange(body: Record<string, string>) {
      return f.app.handle(
        new Request(f.config.origin + "/api/auth/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(body),
        }),
      );
    }
    response = await exchange({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      code: code!,
      code_verifier: verifier,
      resource: f.config.origin + "/mcp",
    });
    assert.equal(response.status, 200, await response.clone().text());
    const tokens = await response.json();
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);
    const payload = decodeJwt(tokens.access_token);
    assert.equal(payload.aud, f.config.origin + "/mcp");
    assert.equal(payload.sub, f.user.id);
    assert.ok(payload.sid);
    assert.ok(payload.calendar_grant_id);
    const internal = (token: string, checkOnly = false) =>
      f.app.internal(
        new Request(f.config.origin + "/internal/access", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + f.config.internalSecret,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token, check_only: checkOnly }),
        }),
      );
    response = await internal(tokens.access_token);
    assert.equal(response.status, 200, await response.clone().text());
    const snapshot = await response.json();
    assert.equal(snapshot.password, PASSWORD);
    assert.deepEqual(snapshot.policy.write_operations, ["create"]);
    response = await internal(tokens.access_token, true);
    assert.deepEqual(await response.json(), { active: true });
    // Increasing current choices must not increase an earlier token or refresh grant.
    f.store.setPolicy({
      read_calendars: ["work", "home"],
      write_calendars: ["work"],
      write_operations: ["create", "update"],
    });
    response = await exchange({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
      resource: f.config.origin + "/mcp",
    });
    assert.equal(response.status, 200, await response.clone().text());
    const refreshed = await response.json();
    assert.ok(
      refreshed.refresh_token,
      "Refresh rotation must retain offline access",
    );
    assert.equal(
      decodeJwt(refreshed.access_token).calendar_grant_id,
      payload.calendar_grant_id,
    );
    snapshot.policy = (
      await (await internal(refreshed.access_token)).json()
    ).policy;
    assert.deepEqual(snapshot.policy, {
      read_calendars: ["work"],
      write_calendars: ["work"],
      write_operations: ["create"],
    });
    response = await f.app.handle(
      new Request(f.config.origin + "/api/auth/oauth2/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.client_id,
          token: refreshed.refresh_token,
          token_type_hint: "refresh_token",
        }),
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await internal(tokens.access_token)).status, 401);
    assert.equal((await internal(refreshed.access_token)).status, 401);
    response = await exchange({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: refreshed.refresh_token,
      resource: f.config.origin + "/mcp",
    });
    assert.notEqual(response.status, 200);
  } finally {
    f.db.close();
  }
});
