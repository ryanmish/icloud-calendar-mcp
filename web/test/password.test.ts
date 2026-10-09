import test from "node:test";
import assert from "node:assert/strict";
import { verifyPassword } from "better-auth/crypto";
import { fixture } from "./helpers.js";

const PASSWORD = "test-service-password-123456";
test("a new installation shows owner setup to a visitor without a session", async () => {
  const f = await fixture("password", false);
  try {
    for (const path of ["/", "/sign-in"]) {
      const response = await f.app.handle(new Request(f.config.origin + path));
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /Create account and continue/);
      assert.match(html, /Host setup code/);
      assert.match(html, /name="csrf"/);
      assert.match(
        response.headers.get("set-cookie") || "",
        /__Host-calendar-browser=.*Secure/,
      );
    }
    assert.equal(f.store.owner(), undefined);
    assert.equal(f.store.connection(), undefined);
  } finally {
    f.db.close();
  }
});
function cookies(response: Response) {
  return (
    response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ") + "; __Host-calendar-browser=test-browser"
  );
}
test("password signup needs the host code, stores a hash, and prefills the entered iCloud address", async () => {
  const f = await fixture("password", false);
  f.config.icloudAddress = "";
  try {
    let response = await f.app.handle(
      f.request("/create-owner", {
        code: "wrong",
        email: "actual@example.com",
        password: PASSWORD,
      }),
    );
    assert.equal(response.status, 400);
    assert.equal(f.store.owner(), undefined);
    response = await f.app.handle(
      f.request("/create-owner", {
        code: f.config.enrollmentCode,
        email: "actual@example.com",
        password: PASSWORD,
      }),
    );
    assert.equal(response.status, 303, await response.clone().text());
    assert.equal(response.headers.get("location"), "/setup");
    const cookie = cookies(response);
    const session = await f.auth.api.getSession({
      headers: new Headers({ Cookie: cookie }),
    });
    assert.equal(session?.user.id, f.store.owner());
    assert.equal(session?.user.emailVerified, false);
    const account = await f.ctx.adapter.findOne<{ password: string }>({
      model: "account",
      where: [{ field: "userId", value: f.store.owner()! }],
    });
    assert.ok(account?.password);
    assert.notEqual(account.password, PASSWORD);
    assert.ok(
      await verifyPassword({ hash: account.password, password: PASSWORD }),
    );
    const html = await (
      await f.app.handle(f.request("/setup", undefined, cookie))
    ).text();
    assert.match(html, /value="actual@example.com"/);
    assert.doesNotMatch(html, new RegExp(PASSWORD));
    assert.equal(f.store.connection(), undefined);
    assert.equal(
      (
        await f.app.handle(
          f.request("/create-owner", {
            code: f.config.enrollmentCode,
            email: "other@example.com",
            password: PASSWORD,
          }),
        )
      ).status,
      400,
    );
    response = await f.app.handle(
      f.request("/login", {
        email: "actual@example.com",
        password: "incorrect-password",
      }),
    );
    assert.equal(response.status, 400);
    response = await f.app.handle(
      f.request("/login", { email: "actual@example.com", password: PASSWORD }),
    );
    assert.equal(response.status, 303, await response.clone().text());
    assert.equal(
      (
        await f.auth.api.getSession({
          headers: new Headers({ Cookie: cookies(response) }),
        })
      )?.user.id,
      f.store.owner(),
    );
  } finally {
    f.db.close();
  }
});

test("password enrollment rejects cross-origin forms, short passwords, and direct signup", async () => {
  const f = await fixture("password", false);
  try {
    const request = f.request("/create-owner", {
      code: f.config.enrollmentCode,
      email: "actual@example.com",
      password: PASSWORD,
    });
    request.headers.set("Origin", "https://untrusted.example");
    assert.equal((await f.app.handle(request)).status, 400);
    assert.equal(
      (
        await f.app.handle(
          f.request("/create-owner", {
            code: f.config.enrollmentCode,
            email: "actual@example.com",
            password: "short",
          }),
        )
      ).status,
      400,
    );
    assert.equal(f.store.owner(), undefined);
    assert.equal(
      (
        await f.app.handle(
          f.request("/api/auth/sign-up/email", {
            email: "actual@example.com",
            password: PASSWORD,
          }),
        )
      ).status,
      400,
    );
    assert.equal(f.store.owner(), undefined);
  } finally {
    f.db.close();
  }
});

test("repeated password login failures are limited by the stored rate counter", async () => {
  const f = await fixture("password", false);
  try {
    for (let i = 0; i < 5; i++) {
      assert.equal(
        (
          await f.app.handle(
            f.request("/login", {
              email: "actual@example.com",
              password: PASSWORD,
            }),
          )
        ).status,
        400,
      );
    }
    const response = await f.app.handle(
      f.request("/login", { email: "actual@example.com", password: PASSWORD }),
    );
    assert.equal(response.status, 429);
    assert.doesNotMatch(await response.text(), new RegExp(PASSWORD));
    assert.equal(f.store.owner(), undefined);
  } finally {
    f.db.close();
  }
});

test("host password recovery revokes sessions and grants without changing iCloud access policy", async () => {
  const f = await fixture("password", false);
  try {
    const created = await f.app.handle(
      f.request("/create-owner", {
        code: f.config.enrollmentCode,
        email: "actual@example.com",
        password: PASSWORD,
      }),
    );
    const cookie = cookies(created);
    f.store.connect("actual@example.com", "aaaa-bbbb-cccc-dddd", "principal", [
      { id: "work", name: "Work", read_only: false },
    ]);
    const grant = f.store.draft(
      "test-flow",
      f.store.owner()!,
      "test-client",
      ["calendar:read"],
      { read_calendars: ["work"], write_calendars: [], write_operations: [] },
    );
    f.store.activate(grant.id);
    const { resetOwnerPassword } = await import("../src/password.js");
    await resetOwnerPassword(
      f.config,
      f.store,
      "new-test-service-password-123456",
    );
    assert.equal(
      await f.auth.api.getSession({ headers: new Headers({ Cookie: cookie }) }),
      null,
    );
    assert.equal(f.store.grant(grant.id)?.active, false);
    assert.equal(f.store.connection()?.status, "connected");
    assert.equal(
      (
        await f.app.handle(
          f.request("/login", {
            email: "actual@example.com",
            password: PASSWORD,
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.app.handle(
          f.request("/login", {
            email: "actual@example.com",
            password: "new-test-service-password-123456",
          }),
        )
      ).status,
      303,
    );
  } finally {
    f.db.close();
  }
});
