# Personal password login and calendar setup

This guide covers the first personal deployment. One installation permits one
service owner and one iCloud account. It does not support shared hosting.

The code and offline tests are implemented. The Docker images build. On 2026-10-09,
the devbox service and Cloudflare route were deployed with writes disabled.
Public HTTPS, OAuth discovery, and refusal of unauthenticated MCP access passed.
`https://cal.ryanmish.com/mcp` is reachable and requires OAuth. A real service
login, iCloud connection, and ChatGPT connection still need the owner's live test.
See the [deployment record](deployment-record.md).

## User flow

1. In ChatGPT web developer mode, add a remote app with the MCP URL and OAuth.
   Select client metadata discovery (CIMD) when that option is available.
2. ChatGPT starts the service authorization flow. The service opens its login page.
3. On the first login only, enter the host enrollment code. This protects the first
   owner record from another visitor. It is a setup code, not a second account password.
4. Enter your actual iCloud address and create a service password with 12 to 128
   characters. Save this password in your password manager. It is separate from
   your Apple password. Later logins use this same service account.
5. The service opens the iCloud setup form. It fills the address from your signup
   entry, `ICLOUD_USERNAME`, or a saved connection. Check the address. The prefill
   is not proof of calendar access. An Apple relay email is not used.
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

There are three separate parts: the service password, the iCloud app-specific
password, and ChatGPT's OAuth grant. The service stores a hash of the service
password with Better Auth. It does not verify email ownership at signup.
Successful CalDAV authentication verifies access to the supplied iCloud account. The explicit account-link approval is therefore required. The
verified CalDAV principal is pinned for later reconnects.

No GitHub plugin package or public directory approval is needed for this first
private connection. Private app setup is documented for eligible ChatGPT web
accounts. Mobile support for this private flow remains unverified. See the
[research and official sources](onboarding-plan.md).

## What the host operator must prepare

The default uses `MCP_LOGIN_METHOD=password`. No Apple Developer account or
paid Apple registration is required for this path. Apple requires two-factor
authentication for an app-specific password. See
[Apple's password guide](https://support.apple.com/en-us/102654).

On the dev box, copy `.env.personal.example` to `.env.personal`. Leave
`ICLOUD_USERNAME` empty to use the address from the first signup. You can set it
as a prefill instead. The address does not grant access. Keep this file private.

When ready for secure host setup, run this script from the repository root:

```sh
python3 scripts/init-personal-secrets.py
```

The script creates four random service key files. It does not print their values,
overwrite existing key files, create an Apple credential, or connect an account.
Use a secure host editor to read `secrets/enrollment` when the browser asks for
the first-owner code. Do not send the code or either password through chat.
No Apple signing key is needed in password mode.

The containers run as UID/GID 10001 by default. For a personal Linux host, you
can set `CALENDAR_UID` and `CALENDAR_GID` in `.env.personal` to the numeric IDs
from `id -u` and `id -g`. Use a non-root account. The user that creates the
protected files must match the container user. This avoids a root ownership step.

```sh
chmod 600 .env.personal secrets/*
chmod 700 secrets data
```

If you keep UID/GID 10001, the operator must instead set `secrets` and `data`
ownership to 10001:10001. The web service refuses secret files with group or
other access. Do not use mode 644 to solve a permission fault.

## Build, migrate, and start

Use `compose.personal.yaml` by itself. Do not merge it with `compose.yaml`, which
retains the original external-issuer deployment.

Run these commands only after the secure files and host settings are ready:

```sh
docker compose --env-file .env.personal -f compose.personal.yaml build
docker compose --env-file .env.personal -f compose.personal.yaml run --rm --no-deps web node dist/migrate.js
docker compose --env-file .env.personal -f compose.personal.yaml up -d
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
| `/create-owner`, `/login` | Protected first signup and password login forms | Yes; host code or password plus CSRF checks |
| `/api/auth/callback/apple` | Optional Apple identity callback | Yes; OAuth state checks apply |
| `/setup`, `/consent`, `/` | Owner setup, approval, and management | Yes; owner login required |
| Python `/internal/discover` on port 8000 | Credential verification and calendar metadata | Private network and service secret |
| Web `/internal/access`, `/internal/repair` on port 3001 | Current grant checks and credential repair state | Private network and service secret |

The public web listener returns 404 for `/internal/*`. Only explicit auth protocol
paths are public. The client creation API, direct Better Auth password signup, direct setup
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
| Existing owner | Sign in with the service password. The signed setup flow continues. No second account is created. |
| Signup or login is cancelled | No calendar access is issued. Start the connection again in ChatGPT. |
| Final consent is cancelled | ChatGPT receives an OAuth denial. Prior grants and permissions remain unchanged. A verified iCloud connection may remain saved. Disconnect it from the dashboard if required. |
| Browser is closed during setup | Verified iCloud setup remains saved. Pending client choices expire after 15 minutes; the provider may expire the signed request sooner. Resume while valid or start again in ChatGPT. |
| iCloud authentication fails | A confirmed CalDAV authentication failure suspends the connection and its grants. Network errors do not clear credentials. Open `/setup`, use a new app-specific password for the same account, then approve a new ChatGPT grant. |
| Reconnect to the same account | Use **Replace iCloud credential** in the dashboard, or `/setup` when repair is required. The saved address is prefilled. The password field is empty. Existing calendar choices remain limited. Revoked grants are not activated again. |
| Different CalDAV principal | Setup is refused, including after iCloud disconnect. A deliberate host reset is required. |
| Remove the app in ChatGPT | Do not assume that the client sent a revoke call. Also use the service dashboard to disconnect its grant. A valid refresh-token revocation call is supported and stops grant access immediately. |
| Disconnect a client in the dashboard | Its grant is disabled and stored refresh records for that grant are removed. Other grants and the iCloud connection remain. |
| Disconnect iCloud | The stored credential and pending flows are removed; all calendar grants stop. The service owner and pinned principal remain. Also revoke the app-specific password at Apple. |
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

Optional Apple login uses `socialProviders.apple`. Its provider function uses
`jose` to sign a 30-day Apple client secret with ES256 when it is called. Rotate
the Apple signing key through Apple's secure setup when needed.

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

After the development build, check both production entry points locally:

```sh
.venv/bin/python scripts/smoke-personal.py
```

This command migrates a temporary database and starts both services on temporary
loopback ports. It checks first-owner setup, OAuth discovery, and refusal of
unauthenticated MCP and private API requests. It stops its services and removes
its temporary files, including after a failed check. It does not create an owner,
calendar connection, or client grant. Do not enter real credentials through these
temporary HTTP listeners. This check does not prove public TLS or ChatGPT access.
`MCP_PORT` can select the Python listener port for local checks; its normal default
remains 8000. The Compose backend URL assumes that default.

The live test must check service signup and login, the tunnel, MCP discovery,
ChatGPT CIMD and return callback, calendar reads, cancellation, credential repair,
and client revocation. Test create/update only on a separate calendar after a
new approval. Check ETag conflict behavior. Keep production writes disabled until
those checks pass.

For multiple users, replace the singleton connection and owner lock with per-user
connections, policies, credentials, and queries. Add tenant isolation tests,
administration, quotas, secret rotation, recovery, and a reviewed registration
policy. Do not remove the owner check and call this a multi-user service.

## Service password recovery

There is no email reset service. Use this host-only command from the repository
on the dev box while the web container is running:

```sh
python3 scripts/reset-owner-password.py
```

The command asks for the new password twice with input hidden. It sends the
password through standard input to the container. It does not put it in an
argument, environment variable, or file. Recovery revokes service sessions and
all client grants. The encrypted iCloud credential and access policy stay in
place. Sign in again and approve a new ChatGPT connection. The command is for
the host operator; it has no public HTTP route. Protect host and Docker access.

Login attempts use Better Auth's database rate limiter: five password attempts
per minute and three signup attempts per minute. The current wrapper uses one
shared bucket per path for this one-owner service. This limits guessing but can
also delay the owner during an attack. Do not treat it as protection against all
traffic floods.

## Optional Apple identity login

The previous Apple login path remains available with `MCP_LOGIN_METHOD=apple`.
It disables password signup and login. It requires Apple developer registration,
a Services ID linked to a primary Apple-platform App ID, Team ID, Key ID, and
`secrets/apple.p8`. Register `cal.ryanmish.com` and this return URL:

```text
https://cal.ryanmish.com/api/auth/callback/apple
```

See [Apple's web setup](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/).
Do not change login methods on an enrolled installation without a reviewed
account migration. Automatic account linking is disabled. Apple identity tokens
never provide iCloud Calendar access. This optional path still needs a live test.
