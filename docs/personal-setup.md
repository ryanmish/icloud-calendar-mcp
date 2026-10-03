# Personal Apple login and calendar setup

This guide covers the first personal deployment. One installation permits one
service owner and one iCloud account. It does not support shared hosting.

The code and offline tests are implemented. The Docker images build. A real Apple
login, iCloud connection, Cloudflare route, and ChatGPT connection still need a
live test. `https://cal.ryanmish.com/mcp` is the intended MCP URL. This guide does
not mean that the URL is live.

## User flow

1. In ChatGPT web developer mode, add a remote app with the MCP URL and OAuth.
   Select client metadata discovery (CIMD) when that option is available.
2. ChatGPT starts the service authorization flow. The service opens its login page.
3. On the first login only, enter the host enrollment code. This protects the first
   owner record from another visitor. It is a setup code, not a second account password.
4. Use Sign in with Apple. The service creates its internal owner record. Later
   logins must use that same Apple identity. Email address matching is disabled.
5. The service opens the iCloud setup form. The address comes from `ICLOUD_USERNAME`
   or a saved, verified connection. It never comes from an Apple relay email.
6. On Apple's account page, create an app-specific password. Return to the setup
   form. Check the address, enter that password, and approve the account link.
   Never enter your normal Apple password in this form or in chat.
7. The service verifies the CalDAV login and discovers the account principal and
   calendars. It stores the credential encrypted. It does not import event data
   during this step.
8. Choose the calendars and operations for this client. The host limits apply.
   Review the choices, then select **Approve and return**.
9. The service returns an OAuth code to ChatGPT. ChatGPT exchanges it with PKCE.
   The connection can then use the approved tools.

There are three separate parts: Apple identity login, the iCloud app-specific
password, and ChatGPT's OAuth grant. Apple identity tokens are not calendar
credentials. Successful CalDAV authentication verifies control of the supplied
account. It does not prove that the Apple login and CalDAV account are the same
Apple identity. The explicit account-link approval is therefore required. The
verified CalDAV principal is pinned for later reconnects.

No GitHub plugin package or public directory approval is needed for this first
private connection. Private app setup is documented for eligible ChatGPT web
accounts. Mobile support for this private flow remains unverified. See the
[research and official sources](onboarding-plan.md).

## What the host operator must prepare

Sign in with Apple still needs Apple developer registration. The fallback removes
the need for Apple Calendar OAuth approval; it does not remove the Apple identity
registration requirement. Apple's web setup requires a Services ID associated
with a primary Apple-platform App ID. Do not assume that a web-only service is
eligible without that registration. See
[Apple's web setup](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)
and the [Better Auth Apple provider](https://better-auth.com/docs/authentication/apple).

Prepare the Services ID, Team ID, Key ID, and Sign in with Apple `.p8` private key.
Register `cal.ryanmish.com` and this return URL:

```text
https://cal.ryanmish.com/api/auth/callback/apple
```

This is the configured Better Auth callback. Verify the real Apple redirect in
the live test. Do not submit an Apple Calendar OAuth application for this version.

On the dev box, copy `.env.personal.example` to `.env.personal`. Set the real
iCloud account address in `ICLOUD_USERNAME`. This value is an editable prefill;
it does not grant calendar access. Set the three Apple developer IDs. These
values are not the Apple account password. Keep the file private and out of Git.

When ready for secure host setup, run this script from the repository root:

```sh
python3 scripts/init-personal-secrets.py
```

The script creates four random service key files. It does not print their values,
overwrite existing key files, create an Apple credential, or connect an account.
Place the downloaded Apple key at `secrets/apple.p8` yourself. Do not put it in a
terminal argument, chat, screenshot, or repository file. Use a secure local editor
to read `secrets/enrollment` when the browser asks for the first-owner code.

The containers run as UID/GID 10001. On a Linux dev box, set file ownership and
permissions before migration:

```sh
chmod 600 .env.personal secrets/*
chmod 700 secrets data
sudo chown -R 10001:10001 secrets data
```

The web service refuses secret files with group or other access. Do not solve a
permission error with mode 644. Use a protected host editor for later key changes.
The script creates service keys only when the operator runs it. It was not run as
part of development.

## Build, migrate, and start

Use `compose.personal.yaml` by itself. Do not merge it with `compose.yaml`, which
retains the original external-issuer deployment.

Run these commands only after the secure files and Apple registration are ready:

```sh
docker compose -f compose.personal.yaml build
docker compose -f compose.personal.yaml run --rm --no-deps web node dist/migrate.js
docker compose -f compose.personal.yaml up -d
```

Migration creates the Better Auth schema with the installed plugin versions. It
also creates the project tables. It does not create a user or connect iCloud.
Back up the database before later schema changes. This version has no automatic
data migration from the original password-file deployment.

The web service publishes only `127.0.0.1:3000`. The Python service and the web
private API have no published ports. The Compose network still needs outbound
HTTPS for Apple and public OAuth discovery.

Use the existing named Cloudflare Tunnel to route `cal.ryanmish.com` to
`http://127.0.0.1:3000`. The file
[`deploy/cloudflared.personal.example.yml`](../deploy/cloudflared.personal.example.yml)
is an example. It is not a live tunnel change. Preserve other tunnel routes.
Keep TLS on the public side. Keep MCP bearer headers and streaming responses.
Do not cache `/mcp`, auth routes, or setup responses. Do not put a Cloudflare
browser challenge in front of MCP requests. Apply edge request limits before
public use. Do not log request bodies or authorization headers.

| Route | Purpose | Public reachability |
| --- | --- | --- |
| `/mcp` | Existing Python MCP transport, proxied by web service | Yes; OAuth required |
| `/.well-known/oauth-protected-resource/...` | Python resource discovery | Yes |
| `/.well-known/oauth-authorization-server/api/auth` | Better Auth issuer metadata | Yes |
| `/api/auth/jwks` | Public RS256 verification keys | Yes |
| `/api/auth/oauth2/authorize`, `/token`, `/revoke` | OAuth protocol routes; all under `/api/auth/oauth2` | Yes; protocol checks apply |
| `/api/auth/callback/apple` | Apple identity callback | Yes; OAuth state checks apply |
| `/setup`, `/consent`, `/` | Owner setup, approval, and management | Yes; owner login required |
| Python `/internal/discover` on port 8000 | Credential verification and calendar metadata | Private network and service secret |
| Web `/internal/access`, `/internal/repair` on port 3001 | Current grant checks and credential repair state | Private network and service secret |

The public web listener returns 404 for `/internal/*`. Only explicit auth protocol
paths are public. The client creation API, password signup, direct setup
continuation, direct consent API, and JWT minting API are not public.

## Read and write limits

The template permits discovery and selection of readable calendars. Writes start
disabled. First complete a read-only connection. The owner dashboard lists calendar
IDs for host configuration. To test writes, choose a separate test calendar. Set
its exact ID in `MCP_WRITE_CALENDARS` and set `MCP_WRITE_OPERATIONS` to
`["create","update"]`, or to the smaller required set. Recreate both services
after a host policy change. Then start a new ChatGPT connection approval and
select those write rights. A host change alone cannot expand an existing grant.

Read access needs `calendar:read`. Writes also need `calendar:write`. Every call
uses the intersection of the host limits, current connection limits, and that
client's approved grant. Removing a right narrows existing grants. Adding it back
does not restore it to those grants; a new approval is required. New calendars
are not selected during reconnect.

Delete, invitations, RSVP, and recurring-event changes remain disabled. Existing
event safety checks and ETag conditions remain in the Python service.

## Cancellation, recovery, and disconnection

| Case | Result and next step |
| --- | --- |
| Existing owner | Apple finds the existing service user. The same signed setup flow continues. No password account is created. |
| Apple login is cancelled | No calendar access is issued. Start the connection again in ChatGPT. |
| Final consent is cancelled | ChatGPT receives an OAuth denial. Prior grants and permissions remain unchanged. A verified iCloud connection may remain saved. Disconnect it from the dashboard if required. |
| Browser is closed during setup | Verified iCloud setup remains saved. Pending client choices expire after 15 minutes; the provider may expire the signed request sooner. Resume while valid or start again in ChatGPT. |
| iCloud authentication fails | A confirmed CalDAV authentication failure suspends the connection and its grants. Network errors do not clear credentials. Open `/setup`, use a new app-specific password for the same account, then approve a new ChatGPT grant. |
| Reconnect to the same account | Use **Replace iCloud credential** in the dashboard, or `/setup` when repair is required. The saved address is prefilled. The password field is empty. Existing calendar choices remain limited. Revoked grants are not activated again. |
| Different CalDAV principal | Setup is refused, including after iCloud disconnect. A deliberate host reset is required. |
| Remove the app in ChatGPT | Do not assume that the client sent a revoke call. Also use the service dashboard to disconnect its grant. A valid refresh-token revocation call is supported and stops grant access immediately. |
| Disconnect a client in the dashboard | Its grant is disabled and stored refresh records for that grant are removed. Other grants and the iCloud connection remain. |
| Disconnect iCloud | The stored credential and pending flows are removed; all calendar grants stop. The Apple identity owner and pinned principal remain. Also revoke the app-specific password at Apple. |
| Sign out | The current service session is removed. Tokens tied to it fail the private access check. Sign in and approve a fresh connection. |
| Service session expires | Sessions last up to 30 days without renewal. Calendar tokens tied to an expired session fail closed. Sign in and reconnect. |

Disconnect removes the active encrypted credential record. SQLite free pages,
WAL files, and earlier backups can still contain old encrypted data. The external
encryption key must remain protected. Revoke the Apple app-specific password to
invalidate that credential at its source.

For a deliberate owner or iCloud account reset, stop both services. Preserve a
protected backup if needed. Move the full database and its WAL/SHM files out of
the data directory, migrate a new database, and restart. All prior sessions and
grants are then invalid. Enroll again with the protected host code. Do not edit
the pinned principal to switch accounts under an old grant.

## Keys, backups, and implementation details

The web service uses Node 24.16.0 and Better Auth 1.7.6. It passes native Fetch
requests to `auth.handler`. It uses Node's `DatabaseSync` SQLite driver through
Better Auth's built-in Kysely support. There is no Next.js, Prisma, Drizzle, or
native SQLite add-on. This replaces the preliminary Next.js suggestion in the
research plan with a smaller server.

Apple login uses `socialProviders.apple`. `jose` signs the Apple client secret
with ES256. The secret lasts 30 days and is generated at process start. Restart
the web service before that deadline; this version has no automatic regeneration
timer. Rotate the Apple signing key through Apple's secure setup when needed.

`oauthProvider()` implements code exchange, PKCE, consent, and refresh.
`jwt()` signs service access tokens with RS256. `cimd()` uses the supplied Node
metadata fetcher. Unauthenticated dynamic client registration is disabled. The
first live ChatGPT test must check CIMD support. The offline OAuth test uses a
fixed test client; it does not prove ChatGPT compatibility. If a client requires
another registration method, implement and test that method before connection.

Service tokens expire after five minutes. Refresh scope is `offline_access`.
The resource is the exact origin plus `/mcp`; the issuer is the origin plus
`/api/auth`. A token carries its user, client, session, and project grant ID.
Refresh retains that grant ID. Python validates the JWT, then asks the private
web API to check current state on every protected request. Each tool checks again
before obtaining credentials. A private service failure denies access.

Project tables store the owner, stable profile ID, pinned principal, encrypted
credential, calendar metadata, policies, grants, and pending setup. The app-specific
password uses AES-256-GCM with a fresh nonce. The 32-byte encryption key stays in
`secrets/encryption`, outside the database. Better Auth encrypts stored provider
tokens with its own configured secret. Account and calendar metadata are not
encrypted by this project. Protect the whole data directory and host backups.

Keep a consistent backup of the stopped database with its keys. Store backups
privately and separately from Git. A lost encryption key requires a new iCloud
connection. Do not replace it under the running service. A changed Better Auth
secret can invalidate sessions and make stored provider tokens unreadable. Rotate
the internal service secret on both containers together. None of these service
keys belong in ChatGPT client configuration.

The OAuth signed-query helper follows Better Auth 1.7.6's canonical format and
uses its supported signing primitive. The provider checks the query again before
issuing a code. This helper must be reviewed when Better Auth is upgraded. See
[third-party notices](../THIRD_PARTY_NOTICES.md).

## Development and remaining proof

```sh
uv sync --locked --extra test
uv run --locked ruff check src tests scripts
uv run --locked pytest -q
cd web
npm ci
npm run check
npm run format:check
npm test
npm run build
```

The tests use fake accounts, fake credentials, generated keys, and an in-memory
database. They cover the real Better Auth authorization-code and refresh flow,
private access checks, immediate revocation, secure setup, owner lock, reconnect,
and permission limits. They do not call Apple's login or iCloud service.

The live test must check Apple registration and login, the tunnel, MCP discovery,
ChatGPT CIMD and return callback, calendar reads, cancellation, credential repair,
and client revocation. Test create/update only on a separate calendar after a
new approval. Check ETag conflict behavior. Keep production writes disabled until
those checks pass.

For multiple users, replace the singleton connection and owner lock with per-user
connections, policies, credentials, and queries. Add tenant isolation tests,
administration, quotas, secret rotation, recovery, and a reviewed registration
policy. Do not remove the owner check and call this a multi-user service.
