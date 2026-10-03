import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { importPKCS8, SignJWT } from "jose";
import { createHmac, createHash } from "node:crypto";
import type { Config } from "./config.js";
import { Store, sameSecret } from "./store.js";
export const hashOAuthToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const flowContext = new AsyncLocalStorage<{ flow?: string }>();
export function enrollmentCookie(secret: string, expires: number): string {
  const value = String(expires);
  return `${value}.${createHmac("sha256", secret)
    .update("enroll:" + value)
    .digest("hex")}`;
}
export function enrolled(cookie: string, secret: string): boolean {
  const exp = Number(cookie.split(".")[0]);
  return (
    exp > Date.now() &&
    exp < Date.now() + 10 * 60_000 &&
    sameSecret(cookie, enrollmentCookie(secret, exp))
  );
}
export function cookieValue(
  headers: Headers | undefined,
  name: string,
): string {
  const part = headers
    ?.get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}
export function createAuth(config: Config, store: Store) {
  const deny = () =>
    new APIError("FORBIDDEN", {
      message: "This installation is for its enrolled owner.",
    });
  return betterAuth({
    database: store.db,
    baseURL: config.origin,
    basePath: "/api/auth",
    secret: config.authSecret,
    emailAndPassword: { enabled: false },
    session: { expiresIn: 30 * 86400, updateAge: 86400 },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    trustedOrigins: [config.origin, "https://appleid.apple.com"],
    logger: { disabled: true },
    onAPIError: { errorURL: config.origin + "/login-error" },
    disabledPaths: [
      "/token",
      "/sign-up/email",
      "/oauth2/create-client",
      "/oauth2/update-client",
      "/oauth2/admin/create-client",
      "/oauth2/admin/update-client",
    ],
    socialProviders: {
      apple: async () => ({
        clientId: config.appleClientId,
        clientSecret: await new SignJWT({})
          .setProtectedHeader({ alg: "ES256", kid: config.appleKeyId })
          .setIssuer(config.appleTeamId)
          .setSubject(config.appleClientId)
          .setAudience("https://appleid.apple.com")
          .setIssuedAt()
          .setExpirationTime("30d")
          .sign(await importPKCS8(config.applePrivateKey, "ES256")),
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (_user, ctx) => {
            if (
              store.owner() ||
              !enrolled(
                cookieValue(ctx?.headers, "__Host-calendar-enroll"),
                config.authSecret,
              )
            )
              throw deny();
          },
          after: async (user) => {
            store.bindOwner(user.id);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            if (session.userId !== store.owner()) throw deny();
          },
        },
      },
    },
    plugins: [
      jwt({
        jwks: { keyPairConfig: { alg: "RS256" }, rotationInterval: 30 * 86400 },
        jwt: {
          issuer: config.origin + "/api/auth",
          audience: config.origin + "/mcp",
        },
      }),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: ["calendar:read", "calendar:write", "offline_access"],
        grantTypes: ["authorization_code", "refresh_token"],
        accessTokenExpiresIn: 300,
        codeExpiresIn: 300,
        storeTokens: { hash: hashOAuthToken },
        resources: [
          {
            identifier: config.origin + "/mcp",
            allowedScopes: [
              "calendar:read",
              "calendar:write",
              "offline_access",
            ],
            accessTokenTtl: 300,
          },
        ],
        clientRegistrationDefaultResources: [config.origin + "/mcp"],
        signup: {
          shouldRedirect: async () =>
            store.connection()?.status === "connected" ? false : "/setup",
        },
        postLogin: {
          page: "/setup",
          shouldRedirect: async ({ session }) =>
            !flowContext.getStore()?.flow ||
            !store.flow(session.id + ":" + flowContext.getStore()!.flow),
          consentReferenceId: async ({ user, session }) => {
            const flow = flowContext.getStore()?.flow;
            const grant = flow
              ? store.flow(session.id + ":" + flow)
              : undefined;
            if (!grant || grant.userId !== user.id) throw deny();
            return grant.id;
          },
        },
        customAccessTokenClaims: async ({ user, referenceId, scopes }) => {
          const g = referenceId ? store.grant(referenceId) : undefined;
          if (
            !user ||
            user.id !== store.owner() ||
            !g?.active ||
            g.userId !== user.id ||
            !scopes.every((s) => g.scopes.includes(s)) ||
            store.connection()?.status !== "connected"
          )
            throw deny();
          return { calendar_grant_id: g.id };
        },
      }),
      cimd({ fetchClientMetadataResource }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
