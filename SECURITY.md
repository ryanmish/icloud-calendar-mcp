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
It does not implement an authorization server or accept arbitrary bearer API keys.

Read tools require `calendar:read`. Write tools require both `calendar:read` and
`calendar:write`. The calendar and operation policy is checked again at execution.
Policy changes require a service restart. Removing an operation blocks existing tokens.

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

The Apple password is read from a restricted regular file. It is not stored in the
repository, container image, client configuration, or MCP results. The process still
holds it in memory. This is file protection, not an encrypted multiuser secret vault.

Apple credentials are only sent to `caldav.icloud.com` and `p<number>-caldav.icloud.com`
over HTTPS on port 443. Redirect targets are checked before the next request.
Proxy environment variables are ignored for CalDAV calls. Responses are limited to 4 MiB.
Search windows are limited to 93 days. Calendar text is untrusted input.

Cloudflare Tunnel makes the MCP route publicly reachable. OAuth protects account data.
Do not put a browser login challenge in front of MCP requests. Keep host administration
under separate access controls. Apply edge request limits before public use.

Token revocation is managed by the identity provider. Offline JWT checks cannot see
immediate revocation; use short-lived access tokens. A service restart with a changed
owner or policy can remove service access before existing tokens expire.

## Report a problem

Use a private GitHub security advisory when available. Do not include credentials or
private event data in a public issue. Enable private vulnerability reporting before
inviting external users.
