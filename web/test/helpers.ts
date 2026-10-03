import { DatabaseSync } from "node:sqlite";
import { createHmac, randomBytes, generateKeyPairSync } from "node:crypto";
import { getMigrations } from "better-auth/db/migration";
import { Store } from "../src/store.js";
import { createAuth } from "../src/auth.js";
import { App } from "../src/app.js";
import type { Config } from "../src/config.js";
export async function fixture() {
  const db = new DatabaseSync(":memory:");
  const config: Config = {
    origin: "https://cal.ryanmish.com",
    database: ":memory:",
    authSecret: "test-auth-secret-not-for-host-use-00000000",
    encryptionKey: randomBytes(32),
    internalSecret: "test-private-secret-not-for-host-use-00000",
    enrollmentCode: "test-owner-code-not-for-host-use-000000000",
    appleClientId: "test.service",
    appleTeamId: "TEAM",
    appleKeyId: "KEY",
    applePrivateKey: generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey,
    icloudAddress: "actual@example.com",
    calendarBackend: "http://127.0.0.1:9999",
    hostPolicy: {
      read_calendars: ["*"],
      write_calendars: ["work"],
      write_operations: ["create", "update"],
    },
  };
  const store = new Store(db, config.encryptionKey);
  const auth = createAuth(config, store);
  await (await getMigrations(auth.options)).runMigrations();
  const ctx = await auth.$context;
  const user = await ctx.adapter.create<{ id: string }>({
    model: "user",
    data: {
      email: "relay@privaterelay.appleid.com",
      name: "Test Owner",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  store.bindOwner(user.id);
  const session = await ctx.internalAdapter.createSession(user.id);
  const signature = createHmac("sha256", config.authSecret)
    .update(session.token)
    .digest("base64");
  const cookies = `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(session.token + "." + signature)}; __Host-calendar-browser=test-browser`;
  const app = new App(config, store, auth, async () => ({
    principal: "https://p01-caldav.icloud.com/123/principal/",
    calendars: [
      { id: "work", name: "Work", read_only: false },
      { id: "home", name: "Home", read_only: false },
    ],
  }));
  function request(
    path: string,
    form?: Record<string, string | string[]>,
    cookie = cookies,
  ) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form || {}))
      for (const val of Array.isArray(v) ? v : [v]) body.append(k, val);
    if (form) {
      body.set(
        "csrf",
        createHmac("sha256", config.authSecret)
          .update("csrf:test-browser:" + session.id)
          .digest("hex"),
      );
    }
    return new Request(config.origin + path, {
      method: form ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        Origin: config.origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form ? body.toString() : undefined,
    });
  }
  return { db, config, store, auth, app, ctx, session, user, cookies, request };
}
