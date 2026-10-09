# Login and iCloud setup plan

> Decision update, 2026-10-03: The owner chose a service password for the personal
> version. No Apple Developer account is available, and no paid registration is
> planned. Better Auth password login is now the default. Signup fills the entered
> iCloud address into the next form; CalDAV verifies access separately. The Apple
> login recommendation below records the earlier research. Use
> [personal setup](personal-setup.md) for the current implementation and steps.


Research date: 2026-10-02. This is a proposed design. It is not a deployment record.

Implementation update: The personal fallback is now implemented. See
[personal setup](personal-setup.md) for the current code, secure host steps, and
remaining live checks. The implementation uses plain Node Fetch handlers and
Node's built-in SQLite driver instead of the preliminary Next.js and
`better-sqlite3` choices below. This file retains the source research and the
Apple Calendar OAuth questions.

## Recommendation

Keep the Python MCP server and its calendar controls. Add a small Better Auth web
service on the same public hostname. Use Apple for service login. Create the
internal user record during that login. Do not add a service password.

Use `https://cal.ryanmish.com/mcp` for the personal deployment. The code and HTTP
tests use `/mcp`. Public reachability has not been tested in this research step.
Other operators will set their own hostname in configuration.

Use the app-specific password path for the first calendar connection, subject to
the Apple login registration check below. Keep a separate adapter boundary for
Apple Calendar OAuth. Do not promise that adapter until Apple confirms eligibility
and gives the integration requirements.

## Verified repository state

The reviewed commit is `83cf4bb654d8ac8f8b91fb6dc992798b3c64fb95` on `main`.
All 67 offline tests pass again. The
[CI run](https://github.com/ryanmish/icloud-calendar-mcp/actions/runs/37070713952)
passed its Python 3.12, 3.13, and 3.14 checks and Docker build.

The current implementation has these parts:

- `auth.py`: external issuer discovery, RS256 token checks, exact audience and
  issuer checks, expiry checks, required scopes, and one allowed OAuth subject.
- `server.py`: authenticated Streamable HTTP at `/mcp`; profile, calendar list,
  event search, event read, event create, and event update tools.
- `config.py`: one Apple account, a protected password file, calendar lists, and
  operation limits. These are startup settings.
- `service.py`: calendar and operation checks before calendar calls, conditional
  writes with ETags, and checks that prevent unsafe event changes.
- `client.py`: restricted iCloud destinations, TLS checks, bounded responses, and
  controls on redirects and write retries.
- Compose and Cloudflare examples: host loopback publishing and restricted
  container settings. They are configuration examples, not proof of deployment.

The task and README record no completed devbox deployment, live iCloud connection,
or ChatGPT end-to-end test. Those remain unverified. `/health` proves process
health only.

There is no internal login service, user database, account setup UI, permission
selection UI, or managed client grant store. The current server reads the Apple
password while it starts. Thus it cannot yet start as an unconnected service and
complete calendar setup during a later ChatGPT connection.

## Guided connection sequence

This is the proposed product sequence. ChatGPT supplies the outer OAuth flow.
Our service must supply the account and calendar setup screens.

1. In ChatGPT web, enable developer mode. Add a remote integration with the MCP
   URL and OAuth. Select CIMD when available. No public directory submission is
   needed for this private test.
2. ChatGPT reads protected-resource metadata and starts the service OAuth flow.
3. Show a service page with Continue with Apple. Keep the pending OAuth request
   bound to a short-lived browser transaction.
4. Verify the Apple login through Better Auth. Find the user by the Apple provider
   subject, or create the internal record. Accept only the enrolled owner on this
   personal installation. Do not match users by email.
5. If there is no valid calendar connection, show Connect iCloud Calendar. Use a
   separate Apple Calendar OAuth flow if approved. Otherwise show the secure
   account address and app-specific password form.
6. Verify the calendar credential through CalDAV discovery. Show the linked
   account and available calendars to the owner. Do not read event contents merely
   to prove the credential.
7. Let the owner choose exact readable calendar IDs, writable calendar IDs, and
   create/update operations. Start with no selected calendars and no writes in
   the new guided flow. The host policy remains an upper limit.
8. Show a final ChatGPT access screen. State the selected calendars, operations,
   requested scopes, and whether refresh access is allowed. Obtain consent. The
   iCloud grant and the ChatGPT grant are separate.
9. Issue the authorization code only after setup and consent are complete. Return
   through the exact callback supplied by ChatGPT. ChatGPT exchanges the code
   with PKCE and obtains a service access token.
10. Check profile and calendar reads. The user can then make tool calls. ChatGPT
    write confirmation does not replace the server's permission checks.

Existing users can skip the completed login and calendar setup steps. They must
still approve any new access. A saved consent is not permission to add a calendar
or operation later.

The fallback requires a visit to `account.apple.com` to generate the app-specific
password. The service should open that page from the setup screen, then resume the
same setup. It cannot generate the password or collect the main Apple password.
There is no second service account password. This is a guided flow, but it is not
entirely inside ChatGPT's page.

[OpenAI developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
documents private remote connections on eligible web accounts. The
[authentication guide](https://developers.openai.com/apps-sdk/build/auth)
defines discovery, callbacks, resource binding, and PKCE.

## Better Auth parts

Better Auth supports Apple social login and OAuth authorization. Keycloak is not
required. It will be a new Node service beside the existing Python service.

Use these components for the proposed implementation:

| Part | Proposed component |
| --- | --- |
| Web route adapter | Next.js route handlers with `toNextJsHandler` from `better-auth/next-js` |
| User and OAuth database | `better-sqlite3`, through Better Auth's built-in Kysely SQLite support |
| Login provider | `socialProviders.apple` in `better-auth` |
| Apple client-secret signing | `jose`; Apple Services ID, Team ID, Key ID, and protected private key |
| Authorization server | `oauthProvider()` from `@better-auth/oauth-provider` |
| Access-token signing | `jwt()` from `better-auth/plugins`, with RS256 to match Python |
| Client metadata discovery | `cimd()` from `@better-auth/cimd`, with `fetchClientMetadataResource` from `@better-auth/cimd/node` |
| Browser OAuth continuation | `oauthProviderClient()` from `@better-auth/oauth-provider/client` |
| Calendar connection and permissions | Project-owned tables and handlers; not supplied by Apple login |

The SQLite choice needs no separate Prisma or Drizzle adapter. Generate the schema
for the pinned plugin versions. Keep user, account, session, verification, JWKS,
OAuth client, consent, token, resource-link, and assertion records as required by
that schema. Add project tables for the owner, encrypted iCloud credential,
calendar policy, pending setup, and the exact access approved for each client.

Configure the service origin as `https://cal.ryanmish.com`, with auth handlers under
`/api/auth`. Read the exact issuer and JWKS URLs from the resulting discovery
document. Do not guess a trailing slash. Set the protected resource to
`https://cal.ryanmish.com/mcp`. Permit `calendar:read`, `calendar:write`, and an
explicit refresh scope when needed. Restrict resource registration to this MCP
resource. Disable password login and unrelated grants.

Set login and consent pages. Add a setup step after login, preserve the signed
OAuth query, and continue only when the owner and connection are valid. Verify
those conditions again on the server before consent, code exchange, and refresh.
Do not set ChatGPT as a client that skips consent. This project-specific setup
gate needs implementation and tests; it is not an automatic Apple feature.

Use CIMD for the first ChatGPT test. It avoids copying client secrets during app
setup. A predefined client is a supported alternative. Enable unauthenticated DCR
only if a target client needs it, with request limits. Client registration must
never create an allowed calendar user.

The current `@better-auth/mcp` plugin is another supported composition. It already
contains the OAuth provider; it must not be installed together with a separate
`oauthProvider()`. Its documented transport example uses TypeScript SDK v2.
Use the standalone provider here to keep Python's existing MCP transport and
resource metadata. Do not force a protocol upgrade or rewrite the calendar tools
to use the TypeScript example.

JWT verification alone cannot provide immediate grant revocation. Add a project
grant ID to service access tokens and check its active state at each protected
request. Check the current connection and policy as well. Use an authenticated
private policy API between Python and the web service; fail closed if it is not
available. Revoke the stored refresh grant too. Short token lifetimes are useful,
but do not replace this check. This extra grant store is a project design.

Sources: [Apple provider](https://better-auth.com/docs/authentication/apple),
[Next.js route adapter](https://better-auth.com/docs/integrations/next),
[SQLite](https://better-auth.com/docs/adapters/sqlite),
[OAuth provider](https://better-auth.com/docs/plugins/oauth-provider),
[JWT](https://better-auth.com/docs/plugins/jwt),
[CIMD](https://better-auth.com/docs/plugins/cimd), and
[MCP composition](https://better-auth.com/docs/plugins/mcp).

## Apple identity and calendar authorization

Ordinary Sign in with Apple proves identity. It does not provide a credential for
CalDAV. Store the verified Apple provider subject against an internal user ID.
Never send the Apple identity token to iCloud as a calendar credential.

Apple's [web login setup](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)
requires a Services ID associated with a primary Apple-platform App ID that has
Sign in with Apple enabled. It also requires registered domains and return URLs.
Better Auth needs the developer credentials listed above. Its Apple callback is
proposed at `https://cal.ryanmish.com/api/auth/callback/apple`; verify it against
the chosen adapter before registration. Keep the signing key server-side and
renew the generated Apple client secret before its maximum six-month lifetime.

The documented website model accompanies an Apple-platform app. The cited page
does not guarantee eligibility for this stand-alone web-only project. Check your
existing App ID and developer account, or ask Apple about this use. This login
registration question is separate from the Calendar OAuth application.

Apple confirms that supported third-party apps can obtain access to iCloud Mail,
Calendar, and Contacts through a separate authorization. Its
[support article](https://support.apple.com/en-us/121539) also describes revocation.
[Apple DTS directs developers to the interest form](https://developer.apple.com/forums/thread/825772).
The [form](https://developer.apple.com/contact/request/icloud-oauth2/) could not be
read in this unsigned research context.

In [the newer discussion](https://developer.apple.com/forums/thread/847329), the
requester is a paid individual developer with an unreleased native iOS app. Apple
DTS explains how an App Store Connect record can supply the app name and URL before
release. This is not approval, and it does not establish a route for a web-only MCP
service.

The following questions remain unknown from the available official material:

- Can an open-source, web-only, self-hosted MCP service qualify?
- Which developer membership and app record requirements apply to this case?
- Can one registration cover independent installations and callback domains, or
  must each operator apply?
- What are the approved scopes, token endpoints, refresh rules, and CalDAV token
  mechanics for this project?

Do not assume acceptance or rejection. Ask these questions before an application.
Do not create a nominal App Store record merely to fill a required field.

For Apple identity login, each installation needs authorized domain and callback
configuration. An independent operator should supply their own developer setup
unless Apple permits a common operator-managed arrangement. Do not distribute a
common private key with the repository. A central login broker is possible as a
different architecture, but would add a dependency to self-hosting. Calendar OAuth
registration sharing remains unconfirmed.

## Secure app-password fallback

After Apple login, ask for the actual Apple account address used for iCloud and a
new app-specific password. Do not fill that address from a private relay email.
Use a session-bound HTTPS POST form with CSRF protection. Do not put the credential
in query strings, tool arguments, browser storage, logs, analytics, error reports,
screenshots, source control, or ChatGPT messages.

Keep Apple's login state and nonce separate from ChatGPT's OAuth state and PKCE
transaction. Do not use an unverified return URL to resume setup. Disable automatic
email-based account linking. Require a valid server session for every setup action;
the presence of a browser cookie alone is not proof of login.

Verify CalDAV principal and calendar-home discovery using the existing restricted
iCloud client. Bind the returned principal to the internal user. Successful
discovery proves access to that calendar account. It does not prove that the Apple
login and calendar account are the same Apple identity. Show the account link to
the owner and ask for explicit approval. Reject changes to the principal during
routine reconnect; an account change needs a fresh link and fresh consent.

Encrypt the credential with a key stored outside the database and source tree.
Give the Python service only the private access it needs. Do not store plaintext
in Better Auth's provider-account fields. Do not return it through MCP. Limit the
web service's outbound calendar requests to the same iCloud rules used by Python.
Store calendar IDs and metadata needed for setup; do not import event contents
into the auth database.

Apple requires two-factor authentication for app-specific passwords. The owner
creates and revokes the password at Apple. A main Apple password change revokes
all app-specific passwords. See
[Apple's password guide](https://support.apple.com/en-us/102654).

The app-specific password does not express this project's per-calendar and
operation policy. The service must enforce that policy on every calendar call.

## Cancellation, recovery, and disconnect

| Situation | Required behavior |
| --- | --- |
| First use | Create the owner record after verified Apple login, connect iCloud, select access, then approve ChatGPT. No calendar access before completion. |
| Existing owner | Reuse the user and valid connection. Show any requested increase. Do not expand a saved grant. |
| Cancel login or setup | Issue no new code or service grant. Keep any prior working grant unchanged. Offer separate removal of a credential saved before cancellation. |
| Cancel final consent | Deny this authorization request. Do not treat cancellation as revocation of an older grant. |
| Interrupted setup | Save non-secret progress server-side. Resume only in the same authenticated user context. If the OAuth transaction expires, start a fresh request in ChatGPT. Never reuse an expired code. |
| Revoked iCloud password or grant | Mark the connection as needing repair on a clear authentication failure. Stop calendar calls. An outage alone must not trigger credential removal. |
| Reconnect ChatGPT | Reuse or reduce the approved calendar/operation set. An increase requires explicit consent and a new grant record. |
| Reconnect iCloud | Verify the same principal. Keep old permission ceilings. Newly found calendars remain unselected. |
| Disconnect ChatGPT | Disable that service grant and revoke its refresh access. Keep the iCloud connection unless the owner also removes it. |
| Disconnect iCloud | Disable dependent service grants, stop calls, and remove the stored calendar credential. Explain how to revoke the password or OAuth grant at Apple as well. |
| Apple service login revoked | Reject new login and disable service sessions/grants when verified provider notification or validation establishes revocation. Do not silently relink by email. |

For each call, use the intersection of the host limit, current account choices,
the client grant's approved calendar/operation set, and token scopes. Increasing
the host limit or discovering a new calendar must not increase an old grant.

## Installation paths

| Path | What this project needs |
| --- | --- |
| Private ChatGPT remote MCP | HTTPS URL, OAuth discovery, auth flow, and working tools. Use developer mode for the first web test. |
| Codex direct remote MCP | Add the URL in Settings or `~/.codex/config.toml`, then authenticate. No plugin package is required. |
| Optional GitHub plugin | Add a subfolder with manifest, skills, and MCP mapping. It does not host the server or replace OAuth. |
| Public directory | A later submission and review. It is not needed for this private proof. |
| Local CLI/STDIO plugin | Local executable setup. It does not by itself make calendar tools available on ChatGPT web or mobile. |

The [plugin guide](https://developers.openai.com/plugins/build/plugins) supports a
root `plugin.json`, optional `mcp.json`, skills, and OpenAI-specific mappings.
The compatibility `.codex-plugin/plugin.json` format also remains supported.
Local/repository marketplaces and the public directory are separate routes.
Their availability differs across clients. OpenAI package testing can map a
previously registered MCP connection ID; it is not a general promise that ChatGPT
accepts a GitHub URL plus an arbitrary endpoint as its normal connect flow.

For self-hosters, put the server origin in deployment configuration. Enter the
resulting MCP URL in ChatGPT's remote integration setup. In Codex, put it under
`mcp_servers.<name>.url` in user configuration. The
[Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp) documents direct remote
setup and OAuth login. Do not put any Apple credential in that client config.

Keep an optional plugin subfolder in this same repository only when skills or
distribution add value. Do not promise a portable endpoint prompt or environment
variable substitution on ChatGPT web. Its hosted connection must be registered
for the operator's URL. Web does not read local Codex configuration.

The verified developer-mode route is web. The reviewed documentation does not
confirm custom developer-mode use on mobile. A remote server is necessary for
mobile access, but it is not sufficient proof of client support. Test the actual
account and mobile client before describing mobile as supported. Public-directory
publication is not a prerequisite for the first web test.

## Implementation order

1. Add the Better Auth web service, a pinned package lock, database migrations,
   login page, and exact discovery routes. Keep Python dependencies and tools.
2. Add owner enrollment. Use a host-controlled, one-time enrollment code entered
   through the setup page, or an existing pinned Apple subject. Do not let the
   first anonymous public visitor become the owner. Lock later registration.
3. Split runtime host settings from connection settings in `config.py`. Allow auth,
   discovery, and setup to start before iCloud is connected. Calendar tools remain
   denied while no complete connection exists.
4. Add the secure credential form and connection store. Replace the startup-only
   shared client in `server.py` with a resolver for the single approved connection.
   Keep `ICloudClient` and `CalendarService` validation.
5. Add calendar selection, operation selection, client-grant snapshots, consent,
   refresh, revoke, and repair screens. Add server checks for setup completion and
   active grants. Use the Better Auth user ID as service-token subject and bind it
   to the permitted owner. Do not confuse it with Apple's provider subject.
6. Update `auth.py` for the new issuer, RS256 JWKS, active-grant checks, and current
   policy. Persist the opaque profile ID; the current hash of issuer and subject
   changes if the issuer changes. Keep client-visible identity stable on reconnect.
7. Add a front route on the same hostname for web/auth and Python MCP. Update
   Compose with a restricted web container and protected database/secret volumes.
   Plan the existing named Cloudflare Tunnel route. Change no live route yet.
8. Test login continuation, wrong-owner rejection, unsigned/expired state, setup
   bypass attempts, PKCE, resource binding, grant revocation, refresh, reconnect
   without increases, secret redaction, and account-principal changes. Retain all
   existing policy, transport, ETag, invitation, and recurrence tests.
9. After operator setup, test unauthenticated rejection and discovery externally.
   Then test real reads through ChatGPT. Permit create/update only on a separate
   test calendar for the first live write test. This step needs the owner.

The tunnel makes the host reachable. Service OAuth makes calendar calls authorized.
Public login and discovery pages must not return calendar data. Preserve bearer
headers and streaming, and avoid browser challenges on MCP routes. Host admin
access remains separate. No DNS, tunnel, or access setting was changed here.

The personal installation stays single-user and single-account. Multi-user hosting
would require per-user connection resolution, isolated credentials and policies,
per-client grants, ownership checks on every record, request limits, recovery, and
isolation tests. Removing the owner check would not be enough.

Deletion, invitations, RSVP writes, and recurring-event changes remain disabled.
They are outside this plan.

## Operator decisions and secure steps

- Confirm the Apple developer account and eligible primary App ID for web login.
  If eligibility is unclear, obtain an Apple answer before promising Apple login.
- Decide whether to ask Apple about Calendar OAuth now. If so, confirm web-only
  eligibility and independent self-host registration before submitting anything.
- Approve the first read calendars and a separate test calendar for create/update.
- At setup time, perform owner enrollment and enter the app-specific password
  directly in the secure form. Create it on Apple's site. Never send it in chat.
- At deployment time, approve the prepared devbox/tunnel configuration and complete
  the ChatGPT OAuth connection. Test mobile support separately if needed.

No Apple application, live credential, account registration, persistent access,
authentication deployment, or live calendar write was made during this research.
