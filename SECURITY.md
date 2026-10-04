# Security

This project is an early implementation. It has no live ChatGPT or iCloud proof yet.
Do not treat passing offline tests as a security audit.

## Access boundary

One installation supports one Apple account and one permitted OAuth subject.
The service rejects other subjects. There is no caller-selected account parameter.
Do not use it as a shared service for several users.

The OAuth provider must issue RS256 access tokens for the exact MCP resource
`https://your-hostname/mcp`. It must support the authorization-code flow, PKCE S256,
discovery, and a supported ChatGPT client registration method. The service checks
signature, issuer, audience, subject, expiry, not-before time, and required scope.
The personal mode includes a Better Auth authorization server. The original mode
uses an external issuer. Neither mode accepts arbitrary bearer API keys.

Read tools require `calendar:read`. Write tools require both `calendar:read` and
`calendar:write`. The calendar and operation policy is checked again at execution.
Host policy changes require a service restart. Personal mode also checks current
connection and client policies on each call. Removing a right narrows stored
grants. A later increase does not restore that right to old grants.

## Writes

Create and update are supported for exact writable calendar IDs. A UUID request ID
and `If-None-Match: *` protect creation from duplicate retries with the same ID.
Updates require a current ETag and use `If-Match`. Unknown event fields are preserved.

Delete, invitation, RSVP, and recurring-event writes are not exposed.
Updates to events with an organizer, attendees, recurrence data, or scheduling METHOD
are rejected. This avoids unintended invitation email from iCloud.

The Apple app-specific password can have more rights than the service exposes.
Host compromise can bypass these controls. Protect the host and its backups.

## Secrets and network

In the original mode, the Apple password is read from a restricted regular file.
In personal mode, only the logged-in owner can enter an app-specific password in
the secure setup form. The web service verifies it through the private Python
service, then stores it with AES-256-GCM encryption. The key is in a protected
file outside SQLite. It is not stored in the repository, image, client
configuration, URL, or MCP results. Both processes can hold it in memory.
This is a personal credential store, not a multiuser secret service.

The iCloud address comes from the owner signup entry, host prefill, or a verified connection.
Apple relay email does not supply it. CalDAV login proves control of that account;
it does not prove email ownership during service signup. The owner must approve
the link. The principal remains pinned across disconnects.

First-owner enrollment needs a random host code and an expiring signed cookie.
Later user creation and sessions for other users are refused. Password login is
the personal default. Better Auth stores a scrypt hash, with 12 to 128 characters
required. Email account linking and email password reset routes are disabled.
Host password recovery revokes all service sessions and client grants. Browser mutations need the exact Origin and
a CSRF value tied to a secure browser cookie and the current session. Setup pages
use no-store, no-referrer, escaping, and a restrictive content security policy.
Password attempts are limited in the database. Signup and login still need a live
test. Apple sign-in is optional and needs developer registration.

The public web service exposes only selected OAuth routes. Client creation and
direct continuation/consent APIs are blocked. CIMD uses Better Auth's supplied
Node metadata fetcher. Dynamic client registration is disabled. Private credential
and policy APIs require a separate service secret and have no published port.
The public listener returns 404 for those paths. Private calls deny access on
failure. Keep both containers and their network under host control.

Apple credentials are only sent to `caldav.icloud.com` and `p<number>-caldav.icloud.com`
over HTTPS on port 443. Redirect targets are checked before the next request.
Proxy environment variables are ignored for CalDAV calls. Responses are limited to 4 MiB.
Search windows are limited to 93 days. Calendar text is untrusted input.

Cloudflare Tunnel makes the MCP route publicly reachable. OAuth protects account data.
Do not put a browser login challenge in front of MCP requests. Keep host administration
under separate access controls. Apply edge request limits before public use.

In the original mode, the identity provider manages token revocation. Offline
JWT checks cannot see immediate revocation. In personal mode, five-minute RS256
tokens carry a project grant ID and session ID. The private API checks the owner,
client, active grant, current connection, scopes, and unexpired session on every
protected request. Dashboard revocation and valid OAuth refresh-token revocation
disable the grant at once. Disconnecting iCloud removes its credential and
disables all grants. Removing an app in a client does not prove that it sent a
revocation request. Revoke its grant in the dashboard too.

SQLite and backups can retain old encrypted data after disconnect. Revoke the
Apple app-specific password at Apple as well. Protect metadata, keys, database,
WAL files, and backups. Optional Apple login signs a 30-day client secret when its provider function is
called. See [personal setup](docs/personal-setup.md)
for recovery, key changes, and the live validation steps.

## Report a problem

Use a private GitHub security advisory when available. Do not include credentials or
private event data in a public issue. Enable private vulnerability reporting before
inviting external users.
