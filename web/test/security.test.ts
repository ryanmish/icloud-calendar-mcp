import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { fixture } from "./helpers.js";
import { enrolled, enrollmentCookie } from "../src/auth.js";
import { flowKey, validatePolicy } from "../src/app.js";
import { verifyOAuthQueryParams } from "../src/oauth-query.js";
import { makeSignature } from "better-auth/crypto";
const password = "aaaa-bbbb-cccc-dddd";
const principal = "https://p01-caldav.icloud.com/123/principal/";
const calendars = [
  { id: "work", name: "Work <script>alert(1)</script>", read_only: false },
  { id: "home", name: "Home", read_only: false },
];
const policy = {
  read_calendars: ["work"],
  write_calendars: ["work"],
  write_operations: ["create"],
};
async function withFixture(
  run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
) {
  const f = await fixture();
  try {
    await run(f);
  } finally {
    f.db.close();
  }
}
async function signedFlow(f: Awaited<ReturnType<typeof fixture>>) {
  const client = await f.auth.api.adminCreateOAuthClient({
    headers: new Headers({ Cookie: f.cookies }),
    body: {
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      scope: "calendar:read calendar:write offline_access",
      resources: [f.config.origin + "/mcp"],
    },
  });
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    response_type: "code",
    scope: "calendar:read calendar:write offline_access",
    state: "a-state",
    code_challenge: createHash("sha256")
      .update("x".repeat(60))
      .digest("base64url"),
    code_challenge_method: "S256",
    resource: f.config.origin + "/mcp",
  });
  const response = await f.app.handle(
    f.request("/api/auth/oauth2/authorize?" + params),
  );
  assert.equal(response.status, 302);
  return new URL(
    response.headers.get("location")!,
    f.config.origin,
  ).search.slice(1);
}
test("public listener does not expose the private credential API", () =>
  withFixture(async (f) => {
    const response = await f.app.handle(f.request("/internal/access"));
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /password|actual@example/);
    const privateResponse = await f.app.internal(
      new Request(f.config.origin + "/internal/access", {
        method: "POST",
        body: "{}",
      }),
    );
    assert.equal(privateResponse.status, 404);
  }));
test("a forged browser cookie does not expose the iCloud address", () =>
  withFixture(async (f) => {
    const response = await f.app.handle(
      f.request("/setup", undefined, "__Host-calendar-browser=forged"),
    );
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /actual@example/);
  }));
test("cross-site credential submission and missing CSRF are refused before discovery", () =>
  withFixture(async (f) => {
    let calls = 0;
    f.app.discover = async () => {
      calls++;
      return { principal, calendars };
    };
    const normal = f.request("/connect", {
      username: "actual@example.com",
      password,
      link: "yes",
    });
    const h = new Headers(normal.headers);
    h.set("Origin", "https://attacker.example");
    assert.equal(
      (await f.app.handle(new Request(normal, { headers: h }))).status,
      400,
    );
    const noCsrf = new Request(f.config.origin + "/connect", {
      method: "POST",
      headers: { Cookie: f.cookies, Origin: f.config.origin },
      body: new URLSearchParams({
        username: "actual@example.com",
        password,
        link: "yes",
      }),
    });
    assert.equal((await f.app.handle(noCsrf)).status, 400);
    assert.equal(calls, 0);
    assert.equal(f.store.connection(), undefined);
  }));
test("credentials are encrypted and do not appear in setup views or failures", () =>
  withFixture(async (f) => {
    f.store.connect("actual@example.com", password, principal, calendars);
    const row = f.db
      .prepare("SELECT secret,data FROM personal_connection")
      .get() as { secret: string; data: string };
    assert.ok(!row.secret.includes(password));
    assert.ok(!row.data.includes(password));
    assert.equal(f.store.password(), password);
    const html = await (await f.app.handle(f.request("/setup"))).text();
    assert.ok(!html.includes(password));
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!html.includes("<script>alert"));
    f.app.discover = async () => {
      throw new Error("secret " + password);
    };
    const fail = await f.app.handle(
      f.request("/connect", {
        username: "actual@example.com",
        password,
        link: "yes",
      }),
    );
    assert.equal(fail.status, 400);
    assert.ok(!(await fail.text()).includes(password));
  }));
test("reconnect keeps the principal and does not select newly found calendars", () =>
  withFixture(async (f) => {
    f.store.connect("actual@example.com", password, principal, calendars);
    f.store.setPolicy(policy);
    f.store.connect("alias@example.com", password, principal, [
      ...calendars,
      { id: "new", name: "New", read_only: false },
    ]);
    assert.deepEqual(f.store.connection()?.policy, policy);
    assert.throws(
      () =>
        f.store.connect(
          "other@example.com",
          password,
          "https://p01-caldav.icloud.com/999/principal/",
          calendars,
        ),
      /different iCloud account/,
    );
    f.store.disconnect();
    assert.throws(
      () =>
        f.store.connect(
          "other@example.com",
          password,
          "https://p01-caldav.icloud.com/999/principal/",
          calendars,
        ),
      /different iCloud account/,
    );
  }));
test("host write ceilings, recurrence operations, and read-only calendars are enforced", () =>
  withFixture(async (f) => {
    assert.throws(() =>
      validatePolicy(
        { ...policy, write_operations: ["delete"] },
        calendars,
        f.config.hostPolicy,
      ),
    );
    assert.throws(() =>
      validatePolicy(
        { ...policy, write_calendars: ["home"] },
        calendars,
        f.config.hostPolicy,
      ),
    );
    assert.throws(() =>
      validatePolicy(
        policy,
        [{ ...calendars[0], read_only: true }],
        f.config.hostPolicy,
      ),
    );
    assert.throws(() =>
      validatePolicy(
        { ...policy, read_calendars: ["*"] },
        calendars,
        f.config.hostPolicy,
      ),
    );
    assert.deepEqual(
      validatePolicy(policy, calendars, f.config.hostPolicy),
      policy,
    );
  }));
test("a permission reduction cannot be reversed for an old grant by later expansion", () =>
  withFixture(async (f) => {
    f.store.connect("actual@example.com", password, principal, calendars);
    f.store.setPolicy(policy);
    const g = f.store.draft(
      "flow",
      f.user.id,
      "client",
      ["calendar:read", "calendar:write"],
      policy,
    );
    f.store.activate(g.id);
    f.store.setPolicy({ ...policy, write_calendars: [], write_operations: [] });
    f.store.setPolicy(policy);
    assert.deepEqual(f.store.grant(g.id)?.policy, {
      read_calendars: ["work"],
      write_calendars: [],
      write_operations: [],
    });
  }));
test("cancelled consent issues no code and leaves the prior policy and grant intact", () =>
  withFixture(async (f) => {
    f.store.connect("actual@example.com", password, principal, calendars);
    f.store.setPolicy(policy);
    const old = f.store.draft(
      "old",
      f.user.id,
      "old-client",
      ["calendar:read"],
      policy,
    );
    f.store.activate(old.id);
    let q = await signedFlow(f);
    let response = await f.app.handle(
      f.request("/permissions", { oauth_query: q, read: ["home"] }),
    );
    assert.equal(response.status, 303, await response.clone().text());
    q = new URL(
      response.headers.get("location")!,
      f.config.origin,
    ).search.slice(1);
    response = await f.app.handle(
      f.request("/approve", { oauth_query: q, accept: "no" }),
    );
    assert.equal(response.status, 303);
    const returned = new URL(response.headers.get("location")!);
    assert.equal(returned.searchParams.get("error"), "access_denied");
    assert.equal(returned.searchParams.get("code"), null);
    assert.equal(f.store.grant(old.id)?.active, true);
    assert.deepEqual(f.store.connection()?.policy, policy);
    assert.equal(f.store.grants(f.user.id).length, 1);
  }));
test("setup continuation cannot be called directly from the public API", () =>
  withFixture(async (f) => {
    const response = await f.app.handle(
      f.request("/api/auth/oauth2/continue", { postLogin: "true" }),
    );
    assert.equal(response.status, 404);
    const directConsent = await f.app.handle(
      f.request("/api/auth/oauth2/consent", { accept: "true" }),
    );
    assert.equal(directConsent.status, 404);
  }));
test("an unsigned or changed OAuth request is refused", () =>
  withFixture(async (f) => {
    const q = await signedFlow(f);
    assert.ok(await verifyOAuthQueryParams(q, f.config.authSecret));
    const changed = new URLSearchParams(q);
    changed.set("scope", "calendar:write");
    assert.equal(
      await verifyOAuthQueryParams(changed.toString(), f.config.authSecret),
      false,
    );
    assert.equal(
      (await f.app.handle(f.request("/setup?" + changed))).status,
      400,
    );
    assert.equal(
      await verifyOAuthQueryParams(q + "&sig=duplicate", f.config.authSecret),
      false,
    );
    const expired = new URLSearchParams({ exp: "1", client_id: "test" });
    expired.sort();
    expired.set(
      "sig",
      await makeSignature(expired.toString(), f.config.authSecret),
    );
    assert.equal(
      await verifyOAuthQueryParams(expired.toString(), f.config.authSecret),
      false,
    );
  }));
test("enrollment requires a signed, unexpired host cookie", () => {
  const secret = "test-only-secret";
  const valid = enrollmentCookie(secret, Date.now() + 1000);
  assert.equal(enrolled(valid, secret), true);
  assert.equal(enrolled(valid + "changed", secret), false);
  assert.equal(
    enrolled(enrollmentCookie(secret, Date.now() - 1000), secret),
    false,
  );
});
test("owner hooks reject a second signup or another user session", () =>
  withFixture(async (f) => {
    await assert.rejects(() =>
      f.ctx.internalAdapter.createUser({
        email: "another@example.com",
        name: "Other",
        emailVerified: true,
      }),
    );
    const other = await f.ctx.adapter.create<{ id: string }>({
      model: "user",
      data: {
        email: "other@example.com",
        name: "Other",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await assert.rejects(() => f.ctx.internalAdapter.createSession(other.id));
    assert.equal(f.store.owner(), f.user.id);
  }));
test("disconnecting iCloud removes the stored credential and disables all grants", () =>
  withFixture(async (f) => {
    f.store.connect("actual@example.com", password, principal, calendars);
    f.store.setPolicy(policy);
    const g = f.store.draft(
      "test",
      f.user.id,
      "test",
      ["calendar:read"],
      policy,
    );
    f.store.activate(g.id);
    f.store.disconnect();
    assert.equal(f.store.connection(), undefined);
    assert.throws(() => f.store.password());
    assert.equal(f.store.grant(g.id)?.active, false);
  }));
test("flow identity stays stable through signed continuation and changes for another transaction", () => {
  assert.equal(
    flowKey("client_id=x&state=a&scope=calendar%3Aread"),
    flowKey("scope=calendar%3Aread&state=a&client_id=x&ba_pl=session&sig=x"),
  );
  assert.notEqual(
    flowKey("client_id=x&state=a"),
    flowKey("client_id=x&state=b"),
  );
});

test("OAuth metadata advertises the exact issuer, PKCE, and remote client metadata", async () => {
  const f = await fixture();
  try {
    const response = await f.app.handle(
      new Request(
        f.config.origin + "/.well-known/oauth-authorization-server/api/auth",
      ),
    );
    assert.equal(response.status, 200);
    const metadata = await response.json();
    assert.equal(metadata.issuer, f.config.origin + "/api/auth");
    assert.equal(
      metadata.authorization_endpoint,
      f.config.origin + "/api/auth/oauth2/authorize",
    );
    assert.equal(
      metadata.token_endpoint,
      f.config.origin + "/api/auth/oauth2/token",
    );
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.equal(metadata.client_id_metadata_document_supported, true);
    assert.equal(metadata.registration_endpoint, undefined);
  } finally {
    f.db.close();
  }
});

test("expired setup drafts cannot activate access", async () => {
  const f = await fixture();
  try {
    f.store.connect("actual@example.com", "aaaa-bbbb-cccc-dddd", "principal", [
      { id: "work", name: "Work", read_only: false },
    ]);
    const grant = f.store.draft(
      "expired-flow",
      f.user.id,
      "client",
      ["calendar:read"],
      { read_calendars: ["work"], write_calendars: [], write_operations: [] },
    );
    f.db.prepare("UPDATE personal_flow SET expires=0").run();
    f.db.prepare("UPDATE personal_grant SET expires=0").run();
    assert.equal(f.store.flow("expired-flow"), undefined);
    f.store.activate(grant.id);
    assert.equal(f.store.grant(grant.id)?.active, false);
  } finally {
    f.db.close();
  }
});

test("credential replacement keeps a verified address and starts with an empty password", async () => {
  const f = await fixture();
  try {
    f.store.connect(
      "verified@example.com",
      "aaaa-bbbb-cccc-dddd",
      "principal",
      [{ id: "work", name: "Work", read_only: false }],
    );
    const response = await f.app.handle(f.request("/reconnect"));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /value="verified@example.com"/);
    assert.doesNotMatch(html, /aaaa-bbbb-cccc-dddd|relay@privaterelay/);
    assert.match(html, /name="password" type="password" autocomplete="off"/);
  } finally {
    f.db.close();
  }
});

test("Apple login starts at the real provider with protected state and a secure callback", async () => {
  const f = await fixture();
  try {
    const cookie = "__Host-calendar-browser=test-browser";
    const body = new URLSearchParams({
      csrf: createHmac("sha256", f.config.authSecret)
        .update("csrf:test-browser:")
        .digest("hex"),
    });
    const response = await f.app.handle(
      new Request(f.config.origin + "/login", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: f.config.origin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }),
    );
    assert.equal(response.status, 303, await response.clone().text());
    const destination = new URL(response.headers.get("location")!);
    assert.equal(destination.origin, "https://appleid.apple.com");
    assert.equal(
      destination.searchParams.get("client_id"),
      f.config.appleClientId,
    );
    assert.equal(
      destination.searchParams.get("redirect_uri"),
      f.config.origin + "/api/auth/callback/apple",
    );
    assert.ok(destination.searchParams.get("state"));
    const cookies = response.headers.getSetCookie().join(";");
    assert.match(cookies, /HttpOnly/);
    assert.match(cookies, /Secure/);
    assert.doesNotMatch(
      destination.toString(),
      /actual@example.com|enrollment|password/,
    );
    const failure = await f.app.handle(
      new Request(f.config.origin + "/login-error?error=cancelled"),
    );
    assert.equal(failure.status, 200);
    assert.match(await failure.text(), /Apple sign-in did not finish/);
  } finally {
    f.db.close();
  }
});
