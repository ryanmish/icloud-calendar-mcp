import { createHash, createHmac, randomUUID } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import { verifyOAuthQueryParams } from "./oauth-query.js";
import {
  cookieValue,
  enrolled,
  enrollmentCookie,
  flowContext,
  hashOAuthToken,
  type Auth,
} from "./auth.js";
import type { Config, Policy } from "./config.js";
import { intersect, sameSecret, Store, type Calendar } from "./store.js";
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self' https://appleid.apple.com https://chatgpt.com http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'; base-uri 'none'",
};
function page(title: string, body: string) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · iCloud Calendar</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><main><p class="brand">iCloud Calendar MCP</p><h1>${esc(title)}</h1>${body}</main></body></html>`,
    { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
  );
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
function redirect(url: string) {
  return new Response(null, {
    status: 303,
    headers: { ...headers, Location: url },
  });
}
export function flowKey(query: string): string {
  const p = new URLSearchParams(query);
  const stable = [
    "client_id",
    "redirect_uri",
    "state",
    "code_challenge",
    "code_challenge_method",
    "scope",
    "resource",
  ].map((k) => [k, p.getAll(k)]);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
export function validatePolicy(
  policy: Policy,
  calendars: Calendar[],
  host: Policy,
): Policy {
  if (
    Object.values(policy).some(
      (v) => !Array.isArray(v) || v.some((x) => typeof x !== "string"),
    ) ||
    !policy.read_calendars.length ||
    policy.read_calendars.includes("*") ||
    policy.write_calendars.some((x) => !policy.read_calendars.includes(x)) ||
    policy.read_calendars.some((x) => !calendars.some((c) => c.id === x)) ||
    policy.write_calendars.some(
      (x) => !calendars.some((c) => c.id === x && !c.read_only),
    ) ||
    policy.write_operations.some((x) => !["create", "update"].includes(x)) ||
    (policy.write_operations.length && !policy.write_calendars.length)
  )
    throw new Error("Select permitted calendars and operations.");
  const limited = intersect(policy, host);
  if (JSON.stringify(limited) !== JSON.stringify(policy))
    throw new Error("This access exceeds the host limits.");
  return policy;
}
export class App {
  constructor(
    public config: Config,
    public store: Store,
    public auth: Auth,
    public discover: (
      username: string,
      password: string,
    ) => Promise<{ principal: string; calendars: Calendar[] }>,
  ) {}
  private csrf(headersIn: Headers, sessionId = "") {
    return createHmac("sha256", this.config.authSecret)
      .update(
        "csrf:" +
          cookieValue(headersIn, "__Host-calendar-browser") +
          ":" +
          sessionId,
      )
      .digest("hex");
  }
  private async query(q: string) {
    if (q && !(await verifyOAuthQueryParams(q, this.config.authSecret)))
      throw new Error(
        "This request has expired. Start the connection again in ChatGPT.",
      );
    return new URLSearchParams(q);
  }
  private async owner(request: Request) {
    const session = await this.auth.api.getSession({
      headers: request.headers,
    });
    if (!session || session.user.id !== this.store.owner())
      throw new Error("Sign in with the enrolled owner account.");
    return session;
  }
  private async body(request: Request, sessionId = "") {
    if (
      request.headers.get("origin") !== this.config.origin ||
      !cookieValue(request.headers, "__Host-calendar-browser")
    )
      throw new Error("The form could not be verified.");
    const form = new URLSearchParams(await request.text());
    if (
      !sameSecret(form.get("csrf") || "", this.csrf(request.headers, sessionId))
    )
      throw new Error("The form could not be verified.");
    return form;
  }
  private hidden(request: Request, q: string, sessionId = "") {
    return `<input type="hidden" name="csrf" value="${esc(this.csrf(request.headers, sessionId))}"><input type="hidden" name="oauth_query" value="${esc(q)}">`;
  }
  private async oauth(
    request: Request,
    path: string,
    body: Record<string, unknown>,
    q: string,
  ) {
    return flowContext.run({ flow: flowKey(q) }, () =>
      this.auth.handler(
        new Request(this.config.origin + "/api/auth" + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Cookie: request.headers.get("cookie") || "",
            Origin: this.config.origin,
          },
          body: JSON.stringify({ ...body, ...(q ? { oauth_query: q } : {}) }),
        }),
      ),
    );
  }
  private async oauthRedirect(response: Response) {
    if (response.status === 429) {
      const out = page(
        "Too many sign-in attempts",
        '<p>Wait one minute, then <a href="/sign-in">try again</a>.</p>',
      );
      return new Response(out.body, { status: 429, headers: out.headers });
    }
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get("location")
    ) {
      const out = redirect(response.headers.get("location")!);
      for (const cookie of response.headers.getSetCookie())
        out.headers.append("Set-Cookie", cookie);
      return out;
    }
    const data = (await response.json()) as {
      url?: string;
      redirect?: boolean;
    };
    if (!response.ok || !data.url || !data.redirect)
      throw new Error(
        "The connection could not continue. Start again in ChatGPT.",
      );
    const out = redirect(data.url);
    for (const cookie of response.headers.getSetCookie())
      out.headers.append("Set-Cookie", cookie);
    return out;
  }
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/internal/"))
      return json({ error: "Not found" }, 404);
    try {
      // Only public browser views receive this cookie. Apple credential bodies never reach logs.
      if (
        request.method === "GET" &&
        ["/", "/sign-in", "/setup", "/reconnect", "/consent"].includes(
          url.pathname,
        ) &&
        !cookieValue(request.headers, "__Host-calendar-browser")
      ) {
        const value = randomUUID();
        const copy = new Headers(request.headers);
        copy.set(
          "cookie",
          (copy.get("cookie") || "") + "; __Host-calendar-browser=" + value,
        );
        const response = await this.handle(
          new Request(request, { headers: copy }),
        );
        response.headers.append(
          "Set-Cookie",
          `__Host-calendar-browser=${value}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        );
        return response;
      }
      if (url.pathname === "/assets/app.css")
        return new Response(css, {
          headers: { ...headers, "Content-Type": "text/css" },
        });
      if (url.pathname === "/assets/app.js")
        return new Response(script, {
          headers: { ...headers, "Content-Type": "text/javascript" },
        });
      if (url.pathname === "/health") return json({ status: "ok" });
      if (request.method === "GET" && url.pathname === "/login-error")
        return page(
          "Sign-in did not finish",
          '<p>No calendar access was approved. Start the connection again in ChatGPT, or <a href="/sign-in">sign in here</a> to manage setup.</p>',
        );
      if (
        url.pathname === "/mcp" ||
        /^\/\.well-known\/oauth-protected-resource(?:\/mcp)?$/.test(
          url.pathname,
        )
      ) {
        const h = new Headers();
        for (const key of [
          "authorization",
          "accept",
          "content-type",
          "mcp-protocol-version",
          "mcp-session-id",
          "last-event-id",
        ]) {
          const v = request.headers.get(key);
          if (v) h.set(key, v);
        }
        const response = await fetch(
          this.config.calendarBackend + url.pathname,
          {
            method: request.method,
            headers: h,
            body: ["GET", "HEAD"].includes(request.method)
              ? undefined
              : await request.arrayBuffer(),
            redirect: "manual",
            signal: AbortSignal.timeout(60_000),
          },
        );
        const out = new Headers(response.headers);
        out.set("Cache-Control", "no-store");
        return new Response(response.body, {
          status: response.status,
          headers: out,
        });
      }
      if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
        if (url.pathname !== "/.well-known/oauth-authorization-server/api/auth")
          return json({ error: "Not found" }, 404);
        return this.auth.handler(
          new Request(
            this.config.origin +
              "/api/auth/.well-known/oauth-authorization-server",
            { headers: request.headers },
          ),
        );
      }
      const authPaths = new Set([
        "/api/auth/oauth2/authorize",
        "/api/auth/oauth2/token",
        "/api/auth/oauth2/revoke",
        "/api/auth/jwks",
        "/api/auth/callback/apple",
        "/api/auth/.well-known/oauth-authorization-server",
      ]);
      if (
        url.pathname === "/api/auth/oauth2/revoke" &&
        request.method === "POST"
      ) {
        const form = new URLSearchParams(await request.clone().text());
        const ctx = await this.auth.$context;
        const where = [
          { field: "token", value: hashOAuthToken(form.get("token") || "") },
        ];
        const previous = await ctx.adapter.findOne<{
          id: string;
          referenceId?: string;
          userId: string;
          revoked: Date | null;
        }>({ model: "oauthRefreshToken", where });
        const response = await this.auth.handler(request);
        if (response.ok && previous?.referenceId && !previous.revoked) {
          const now = await ctx.adapter.findOne<{ revoked: Date | null }>({
            model: "oauthRefreshToken",
            where,
          });
          if (now?.revoked)
            this.store.revoke(previous.referenceId, previous.userId);
        }
        return response;
      }
      if (authPaths.has(url.pathname))
        return flowContext.run({ flow: flowKey(url.search.slice(1)) }, () =>
          this.auth.handler(request),
        );
      const q = url.search.slice(1);
      if (
        request.method === "GET" &&
        ["/", "/sign-in"].includes(url.pathname)
      ) {
        await this.query(q);
        const session = await this.auth.api.getSession({
          headers: request.headers,
        });
        if (session?.user.id === this.store.owner())
          return this.dashboard(request, q);
        const form = this.hidden(request, q);
        if (this.config.loginMethod === "password") {
          const first = !this.store.owner();
          return page(
            first ? "Set up your calendar connection" : "Sign in",
            `<p>${first ? "Create the one-owner account for this service. No Apple Developer account is needed." : "Use your calendar service password."}</p>
            <form method="post" action="${first ? "/create-owner" : "/login"}">${form}
            ${first ? '<label>Host setup code<input name="code" type="password" autocomplete="off" required></label><p>Use the code from the protected setup file on your dev box. It is needed only for first setup.</p>' : ""}
            <label>iCloud account address<input name="email" type="email" autocomplete="username" value="${esc(this.config.icloudAddress)}" required></label>
            <label>Service password<input name="password" type="password" autocomplete="${first ? "new-password" : "current-password"}" minlength="12" maxlength="128" required></label>
            <p>${first ? "Use a new password with at least 12 characters. Do not use your Apple account password. The next step asks for the separate iCloud app-specific password." : "This password signs you in to the calendar service. It is separate from the iCloud app-specific password."}</p>
            <button>${first ? "Create account and continue" : "Sign in"}</button></form>`,
          );
        }
        return page(
          "Connect your calendar",
          `<p>Use your Apple account to sign in. Then connect iCloud Calendar. There is no service password.</p>
          ${!this.store.owner() && !enrolled(cookieValue(request.headers, "__Host-calendar-enroll"), this.config.authSecret) ? `<form method="post" action="/enroll">${form}<label>Host enrollment code<input name="code" type="password" autocomplete="off" required></label><button>Unlock owner setup</button></form><p>The host creates this code. It prevents another person from taking this installation.</p>` : ""}
          <form id="apple-login" method="post" action="/login">${form}<button>Continue with Apple</button></form><p id="error" role="alert"></p>`,
        );
      }
      if (request.method === "POST" && url.pathname === "/create-owner") {
        const form = await this.body(request);
        const query = form.get("oauth_query") || "";
        await this.query(query);
        if (
          this.config.loginMethod !== "password" ||
          this.store.owner() ||
          !sameSecret(form.get("code") || "", this.config.enrollmentCode)
        )
          throw new Error("Owner enrollment could not be verified.");
        const copy = new Headers(request.headers);
        copy.set(
          "Cookie",
          (copy.get("Cookie") || "") +
            "; __Host-calendar-enroll=" +
            enrollmentCookie(this.config.authSecret, Date.now() + 9 * 60_000),
        );
        const response = await this.oauth(
          new Request(request.url, { headers: copy }),
          "/sign-up/email",
          {
            email: form.get("email"),
            password: form.get("password"),
            name: "Calendar owner",
            callbackURL: this.config.origin + "/setup",
          },
          query,
        );
        if (query) return await this.oauthRedirect(response);
        if (!response.ok) return await this.oauthRedirect(response);
        const out = redirect("/setup");
        for (const cookie of response.headers.getSetCookie())
          out.headers.append("Set-Cookie", cookie);
        return out;
      }
      if (request.method === "POST" && url.pathname === "/enroll") {
        const form = await this.body(request);
        const query = form.get("oauth_query") || "";
        await this.query(query);
        if (
          this.store.owner() ||
          !sameSecret(form.get("code") || "", this.config.enrollmentCode)
        )
          throw new Error("Owner enrollment could not be verified.");
        const response = redirect("/sign-in" + (query ? "?" + query : ""));
        response.headers.set(
          "Set-Cookie",
          `__Host-calendar-enroll=${enrollmentCookie(this.config.authSecret, Date.now() + 9 * 60_000)}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=540`,
        );
        return response;
      }
      if (request.method === "POST" && url.pathname === "/login") {
        const form = await this.body(request);
        const query = form.get("oauth_query") || "";
        await this.query(query);
        if (this.config.loginMethod === "password")
          return await this.oauthRedirect(
            await this.oauth(
              request,
              "/sign-in/email",
              {
                email: form.get("email"),
                password: form.get("password"),
                callbackURL: this.config.origin + "/setup",
              },
              query,
            ),
          );
        const response = await this.oauth(
          request,
          "/sign-in/social",
          {
            provider: "apple",
            callbackURL: this.config.origin + "/setup",
            errorCallbackURL: this.config.origin + "/login-error",
          },
          query,
        );
        return await this.oauthRedirect(response);
      }
      const session = await this.owner(request);
      if (
        request.method === "GET" &&
        ["/setup", "/reconnect"].includes(url.pathname)
      ) {
        const params = await this.query(q);
        const c = this.store.connection();
        const hidden = this.hidden(request, q, session.session.id);
        if (!c || c.status !== "connected" || url.pathname === "/reconnect")
          return page(
            "Connect iCloud Calendar",
            `<p>Your service sign-in does not provide calendar access. Create an app-specific password on <a href="https://account.apple.com" target="_blank" rel="noopener noreferrer">Apple’s account page</a>, then return here.</p>
          <form method="post" action="/connect">${hidden}<label>iCloud account address<input name="username" type="email" autocomplete="username" value="${esc(c?.username || this.config.icloudAddress || (this.config.loginMethod === "password" ? session.user.email : ""))}" required></label>
          <p>Check this prefilled address. Calendar access is verified separately. Apple’s relay email does not supply this value.</p>
          <label>App-specific password<input name="password" type="password" autocomplete="off" pattern="[a-z]{4}(-[a-z]{4}){3}" required></label>
          <label class="check"><input type="checkbox" name="link" value="yes" required>I approve linking this iCloud account to my service account.</label><button>Verify and connect</button></form><p>Enter only the app-specific password. The service stores it encrypted.</p>`,
          );
        const host = this.config.hostPolicy;
        const selected = params.get("client_id")
          ? this.store.latestGrant(session.user.id, params.get("client_id")!)
              ?.policy || {
              read_calendars: [],
              write_calendars: [],
              write_operations: [],
            }
          : c.policy;
        const selectable = c.calendars.filter(
          (x) =>
            host.read_calendars.includes("*") ||
            host.read_calendars.includes(x.id),
        );
        return page(
          "Choose calendar access",
          `<p>Connected iCloud account: ${esc(c.username)}.</p><p>${params.get("client_id") ? "Choose access for this ChatGPT or MCP connection." : "Choose the service calendar limits."}</p>
          <form method="post" action="/permissions">${hidden}${selectable
            .map(
              (
                cal,
              ) => `<fieldset><legend>${esc(cal.name)}</legend><label class="check"><input type="checkbox" name="read" value="${esc(cal.id)}" ${selected.read_calendars.includes(cal.id) ? "checked" : ""}>Read</label>
            ${!cal.read_only && host.write_calendars.includes(cal.id) ? `<label class="check"><input type="checkbox" name="write" value="${esc(cal.id)}" ${selected.write_calendars.includes(cal.id) ? "checked" : ""}>Write</label>` : ""}</fieldset>`,
            )
            .join("")}
          ${host.write_operations.map((op) => `<label class="check"><input type="checkbox" name="operation" value="${esc(op)}" ${selected.write_operations.includes(op) ? "checked" : ""}>${esc(op)} events</label>`).join("")}
          <p>Deletion, invitations, and recurring-event changes are disabled.</p><button>Continue</button></form>`,
        );
      }
      if (request.method === "POST" && url.pathname === "/connect") {
        const form = await this.body(request, session.session.id);
        const query = form.get("oauth_query") || "";
        await this.query(query);
        const username = (form.get("username") || "").trim();
        const password = (form.get("password") || "").trim();
        if (
          form.get("link") !== "yes" ||
          username.length > 254 ||
          !/^[^\s@]+@[^\s@]+$/.test(username) ||
          !/^[a-z]{4}(?:-[a-z]{4}){3}$/.test(password)
        )
          throw new Error(
            "Enter the iCloud address and app-specific password, then approve the link.",
          );
        const result = await this.discover(username, password);
        this.store.connect(
          username,
          password,
          result.principal,
          result.calendars,
        );
        return redirect("/setup" + (query ? "?" + query : ""));
      }
      if (request.method === "POST" && url.pathname === "/permissions") {
        const form = await this.body(request, session.session.id);
        const query = form.get("oauth_query") || "";
        const params = await this.query(query);
        const c = this.store.connection();
        if (!c || c.status !== "connected")
          throw new Error("Connect iCloud first.");
        const policy = validatePolicy(
          {
            read_calendars: [...new Set(form.getAll("read"))],
            write_calendars: [...new Set(form.getAll("write"))],
            write_operations: [...new Set(form.getAll("operation"))],
          },
          c.calendars,
          this.config.hostPolicy,
        );
        if (!query) {
          this.store.setPolicy(policy);
          return redirect("/");
        }
        const scopes = (params.get("scope") || "").split(" ").filter(Boolean);
        if (
          !scopes.includes("calendar:read") ||
          scopes.some(
            (s) =>
              !["calendar:read", "calendar:write", "offline_access"].includes(
                s,
              ),
          )
        )
          throw new Error("This client requested unsupported access.");
        this.store.draft(
          session.session.id + ":" + flowKey(query),
          session.user.id,
          params.get("client_id") || "",
          scopes,
          policy,
        );
        return this.oauthRedirect(
          await this.oauth(
            request,
            "/oauth2/continue",
            { postLogin: true },
            query,
          ),
        );
      }
      if (request.method === "GET" && url.pathname === "/consent") {
        const params = await this.query(q);
        const grant = this.store.flow(session.session.id + ":" + flowKey(q));
        if (!grant || grant.userId !== session.user.id)
          throw new Error("Choose calendar access again.");
        return page(
          "Approve access",
          `<p>Client: ${esc(params.get("client_id"))}</p><p>iCloud account: ${esc(this.store.connection()?.username)}</p>
          <p>Readable calendars: ${grant.policy.read_calendars.length}. Writable calendars: ${grant.policy.write_calendars.length}.</p>
          <ul>${grant.policy.read_calendars.map((id) => `<li>${esc(this.store.connection()?.calendars.find((c) => c.id === id)?.name || id)} — ${grant.policy.write_calendars.includes(id) ? esc(grant.policy.write_operations.join(", ") || "read only") : "read only"}</li>`).join("")}</ul>
          <p>${grant.scopes.includes("offline_access") ? "This client can renew access while your service sign-in and this grant remain active." : "This grant does not include refresh access."}</p>
          <p>This approval is separate from the iCloud credential. New calendars and operations need a new approval.</p>
          <form method="post" action="/approve">${this.hidden(request, q, session.session.id)}<button name="accept" value="yes">Approve and return</button><button class="secondary" name="accept" value="no">Cancel</button></form>`,
        );
      }
      if (request.method === "POST" && url.pathname === "/approve") {
        const form = await this.body(request, session.session.id);
        const query = form.get("oauth_query") || "";
        await this.query(query);
        const grant = this.store.flow(
          session.session.id + ":" + flowKey(query),
        );
        if (!grant || grant.userId !== session.user.id || grant.active)
          throw new Error("This request has expired. Start again in ChatGPT.");
        const accept = form.get("accept") === "yes";
        if (accept) {
          const prior = this.store.connection()!.policy;
          this.store.setPolicy({
            read_calendars: [
              ...new Set([
                ...prior.read_calendars,
                ...grant.policy.read_calendars,
              ]),
            ],
            write_calendars: [
              ...new Set([
                ...prior.write_calendars,
                ...grant.policy.write_calendars,
              ]),
            ],
            write_operations: [
              ...new Set([
                ...prior.write_operations,
                ...grant.policy.write_operations,
              ]),
            ],
          });
          this.store.activate(grant.id);
        }
        try {
          return await this.oauthRedirect(
            await this.oauth(
              request,
              "/oauth2/consent",
              { accept, scope: grant.scopes.join(" ") },
              query,
            ),
          );
        } catch (e) {
          this.store.revoke(grant.id, session.user.id);
          throw e;
        }
      }
      if (
        request.method === "POST" &&
        ["/disconnect", "/revoke", "/logout"].includes(url.pathname)
      ) {
        const form = await this.body(request, session.session.id);
        if (url.pathname === "/disconnect") this.store.disconnect();
        if (url.pathname === "/revoke") {
          const id = form.get("grant") || "";
          this.store.revoke(id, session.user.id);
          const ctx = await this.auth.$context;
          await ctx.adapter.deleteMany({
            model: "oauthRefreshToken",
            where: [
              { field: "referenceId", value: id },
              { field: "userId", value: session.user.id },
            ],
          });
        }
        if (url.pathname === "/logout") {
          const response = await this.auth.handler(
            new Request(this.config.origin + "/api/auth/sign-out", {
              method: "POST",
              headers: {
                Cookie: request.headers.get("cookie") || "",
                Origin: this.config.origin,
                "Content-Type": "application/json",
              },
              body: "{}",
            }),
          );
          const out = redirect("/sign-in");
          for (const cookie of response.headers.getSetCookie())
            out.headers.append("Set-Cookie", cookie);
          return out;
        }
        return redirect("/");
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      // No error objects, bodies, tokens, or credentials are logged or returned.
      const known =
        error instanceof Error &&
        [
          "This request has expired. Start the connection again in ChatGPT.",
          "Sign in with the enrolled owner account.",
          "Select permitted calendars and operations.",
          "This access exceeds the host limits.",
          "This is a different iCloud account. Host reset is required.",
          "Connect iCloud first.",
        ].includes(error.message);
      const failure = page(
        "Setup could not continue",
        `<p>${esc(known ? error.message : "Check your setup details, then try again. No new access was approved.")}</p><p><a href="/sign-in">Sign in</a>, <a href="/setup">open calendar setup</a>, or restart the connection in ChatGPT.</p>`,
      );
      return new Response(failure.body, {
        status: 400,
        headers: failure.headers,
      });
    }
  }
  private async dashboard(request: Request, q: string) {
    const session = await this.owner(request);
    const c = this.store.connection();
    if (q) return redirect("/setup?" + q);
    return page(
      "Your calendar connection",
      `<p>${c ? `iCloud account: ${esc(c.username)}. Status: ${esc(c.status)}.` : "iCloud is not connected."}</p><p><a href="/setup">Connect or manage iCloud</a>${c ? ' · <a href="/reconnect">Replace iCloud credential</a>' : ""}</p>
      <p>MCP URL: <code>${esc(this.config.origin)}/mcp</code></p><p>Add this URL in ChatGPT web developer mode, with OAuth.</p>
      ${c ? `<details><summary>Calendar IDs for host configuration</summary><ul>${c.calendars.map((cal) => `<li>${esc(cal.name)}: <code>${esc(cal.id)}</code></li>`).join("")}</ul></details>` : ""}
      ${this.store
        .grants(session.user.id)
        .map(
          (g) =>
            `<form method="post" action="/revoke">${this.hidden(request, "", session.session.id)}<input type="hidden" name="grant" value="${esc(g.id)}"><p>Connected client: ${esc(g.clientId)}</p><button>Disconnect this client</button></form>`,
        )
        .join("")}
      ${c ? `<form method="post" action="/disconnect">${this.hidden(request, "", session.session.id)}<p>Disconnecting iCloud stops all calendar access. Also revoke the app-specific password on Apple’s account page.</p><button>Disconnect iCloud</button></form>` : ""}
      <form method="post" action="/logout">${this.hidden(request, "", session.session.id)}<button class="secondary">Sign out</button></form>`,
    );
  }
  async internal(request: Request): Promise<Response> {
    if (
      !sameSecret(
        request.headers.get("authorization") || "",
        "Bearer " + this.config.internalSecret,
      )
    )
      return json({ error: "Not found" }, 404);
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (new URL(request.url).pathname === "/internal/repair") {
        this.store.repair(String(body.connection_id));
        return json({ ok: true });
      }
      if (
        new URL(request.url).pathname !== "/internal/access" ||
        typeof body.token !== "string"
      )
        return json({ active: false }, 401);
      const jwks = await (
        await this.auth.handler(
          new Request(this.config.origin + "/api/auth/jwks"),
        )
      ).json();
      const { payload } = await jwtVerify(body.token, createLocalJWKSet(jwks), {
        algorithms: ["RS256"],
        issuer: this.config.origin + "/api/auth",
        audience: this.config.origin + "/mcp",
        requiredClaims: ["exp", "sub", "client_id", "calendar_grant_id", "sid"],
      });
      const grant = this.store.grant(String(payload.calendar_grant_id));
      const connection = this.store.connection();
      const scopes =
        typeof payload.scope === "string" ? payload.scope.split(" ") : [];
      if (
        payload.sub !== this.store.owner() ||
        !grant?.active ||
        grant.userId !== payload.sub ||
        grant.clientId !== payload.client_id ||
        !scopes.includes("calendar:read") ||
        scopes.some((x) => !grant.scopes.includes(x)) ||
        connection?.status !== "connected" ||
        connection.id !== grant.connectionId
      )
        throw new Error("Inactive");
      const ctx = await this.auth.$context;
      const session = await ctx.adapter.findOne<{
        userId: string;
        expiresAt: Date;
      }>({
        model: "session",
        where: [{ field: "id", value: String(payload.sid) }],
      });
      if (
        !session ||
        session.userId !== payload.sub ||
        new Date(session.expiresAt).getTime() <= Date.now()
      )
        throw new Error("Inactive");
      if (body.check_only) return json({ active: true });
      const policy = intersect(
        intersect(grant.policy, connection.policy),
        this.config.hostPolicy,
      );
      if (!scopes.includes("calendar:write")) {
        policy.write_calendars = [];
        policy.write_operations = [];
      }
      return json({
        active: true,
        profile_id: this.store.meta("profile"),
        connection_id: connection.id,
        username: connection.username,
        password: this.store.password(),
        policy,
      });
    } catch {
      return json({ active: false }, 401);
    }
  }
}
const script = `const clear=()=>document.querySelectorAll('input[type="password"]').forEach(e=>{e.value='';});clear();window.addEventListener('pageshow',clear);`;
const css = `:root{color-scheme:light;--ink:#20352f;--accent:#276d56}*{box-sizing:border-box}body{margin:0;background:#f4f5ee;color:var(--ink);font:17px/1.55 system-ui,sans-serif}main{max-width:680px;margin:5vh auto;padding:32px;background:#fff;border:1px solid #dde2d7;border-radius:18px}.brand{font-size:14px;letter-spacing:.05em;color:#627469}h1{font-size:32px;line-height:1.2}label{display:block;margin:20px 0 8px}input[type=email],input[type=password]{width:100%;padding:12px;border:1px solid #8b9b92;border-radius:8px;font:inherit}.check{display:flex;gap:12px;align-items:center}button{background:var(--accent);color:white;border:0;border-radius:8px;padding:12px 20px;font:inherit;cursor:pointer;margin:8px 8px 8px 0}.secondary{background:#e6eee8;color:var(--ink)}a{color:var(--accent)}fieldset{border:1px solid #ccd9cf;border-radius:8px;margin:16px 0}code{overflow-wrap:anywhere}form+form{border-top:1px solid #dbe4dd;margin-top:24px;padding-top:20px}@media(max-width:720px){main{margin:16px;padding:24px}}`;
