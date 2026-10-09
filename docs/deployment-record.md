# Personal deployment record

Date: 2026-10-03. Host: the saved `devbox` SSH host.

## Verified preparation

- The existing pull request is open as a draft. All GitHub checks pass for
  `52fd180148285982ffeea711798021748e0453d3`.
- The dev box is reachable through the existing SSH setup.
- Docker and Docker Compose are available. The user can run Docker.
- The repository is copied to `/home/ryan/docker/icloud-calendar-mcp`.
- The checkout uses `feat/personal-onboarding` at the commit above.
- The Python image `icloud-calendar-mcp:52fd180` builds on this host.
- The web image `icloud-calendar-mcp-web:52fd180` builds on this host.
- Port 3000 has no listener at the time of this check.
- A Cloudflare Tunnel process is running with local configuration. Its configuration
  is at `/home/ryan/.cloudflared/config.yml`. It has four hostname rules. No explicit
  rule for `cal.ryanmish.com` is present. This does not prove the public DNS state.

These checks do not prove a live MCP endpoint. The project containers have not
been started. No Apple credential, service owner, or client grant was created.
No DNS or tunnel setting was changed.

## Personal login decision

The owner chose a service password. No Apple Developer account is available,
and the owner does not want paid registration. The personal default is now
`MCP_LOGIN_METHOD=password`. Optional Apple login remains in the code.

The first form requires the protected host code, an iCloud address, and a new
service password. The second form fills that address and asks for a separate
iCloud app-specific password. CalDAV verifies access; signup email alone does
not prove account control. Better Auth stores a hash of the service password.

Local validation passes: 79 Python tests, 24 web tests, TypeScript checks, build,
format checks, and Python lint. Offline checks cover signup, later login, refusal of a second owner, CSRF,
password rate limits, host password recovery, the full PKCE code exchange,
refresh, and immediate grant revocation. They use fake accounts and credentials.

No Apple application or account purchase is needed for this password path.
The app-specific password still requires Apple two-factor authentication.
See [Apple's guide](https://support.apple.com/en-us/102654).
Both passwords must be entered through secure user-controlled input.
Do not put them in chat, shell arguments, logs, source control, screenshots, or URLs.

## Next steps

1. Prepare secure host files for the password login path.
2. Prepare protected service files and the host environment. Keep the actual
   iCloud address in the browser signup form for the next form prefill.
3. Migrate the database and start the two project services with writes disabled.
4. Verify the private service checks and denial of unauthenticated MCP calls.
5. Prepare and validate the exact tunnel rule. Preserve the existing routes.
6. Verify public HTTPS, OAuth discovery, owner setup, and a ChatGPT connection.
7. Test reads first. Enable writes only for a selected test calendar after a new
   approval. Keep delete, invitations, RSVP, and recurring-event changes disabled.

Do not mark a step complete without its verification result. Store only
non-secret results in this record.

## Password build verification

Commit `1ea3e56` adds the personal password flow. The existing draft pull
request and branch contain it. All GitHub Python, web, and container checks pass
for this code. The clean dev box checkout was updated to that commit. The image
`icloud-calendar-mcp-web:1ea3e56` builds on the dev box.

This update did not start containers, create service keys or accounts, enter
Apple credentials, or change DNS or tunnel settings. Live iCloud and ChatGPT
proof remains open. Use the secure setup steps in the personal guide.

## Approved read-only deployment, 2026-10-09

The owner explicitly approved creating protected service files, building and
starting the Calendar services on the existing dev box, and adding the calendar
hostname to the existing Cloudflare Tunnel and DNS. Calendar writes stay disabled.
This approval did not authorize credential entry, email access, or Reminders access.

Deployed implementation commit: `894ff10af69d8f247f632d9276aced8ba73bd49c`.
It fixes first-owner page loading and adds a temporary two-process startup check.
The original local Reminders research edits were preserved and committed.
Local validation passes: 79 Python tests, 25 web tests, lint, TypeScript checks,
format checks, build, and the temporary startup check.

Verified on the dev box:

- The clean checkout was advanced from `1ea3e56` to the reviewed implementation.
- Both updated container images build. Database migration completes.
- Protected environment and service key files use mode 0600. The key directory
  uses mode 0700. Containers use the existing non-root host UID/GID 1000.
- Both Compose services are running and healthy. The only published port is
  `127.0.0.1:3000`; the Python and private web APIs have no published port.
- Host write calendar and operation lists are empty.
- At startup, the database had zero owners and zero connected iCloud accounts.
  No account or Apple credential was created by deployment.

The existing user-managed tunnel configuration was backed up to
`/home/ryan/.cloudflared/config.before-calendar-20261009T204601Z.yml`.
Only the `cal.ryanmish.com -> http://127.0.0.1:3000` rule was inserted before
the catch-all. The candidate passed ingress validation. The DNS command created
or confirmed its route without the overwrite flag. The existing user service was
restarted and registered four tunnel connections. All five original ingress
rules are unchanged; the configuration now has six rules.

Public checks passed with TLS certificate verification:

| Check | Result |
| --- | --- |
| `/health` | 200, service healthy |
| `/sign-in` | 200, first-owner form, Secure cookie, no-store response |
| `/.well-known/oauth-protected-resource/mcp` | 200, exact MCP resource and issuer |
| `/.well-known/oauth-authorization-server/api/auth` | 200, exact issuer, S256 PKCE, CIMD advertised |
| `/api/auth/jwks` | 200; the Python container can also fetch it |
| `/internal/access` and `/internal/discover` on the public hostname | 404 |
| Unauthenticated MCP `tools/list` POST | 401, OAuth resource discovery challenge |

Initial probes using Python urllib's default User-Agent received HTTP 403.
Repeated checks with an explicit service User-Agent, a browser User-Agent, local
curl, and the Python container's httpx client reached the service. No Cloudflare
security rule was changed. The real ChatGPT network/client path remains untested.

The four preserved hostname routes returned 200, 200, 502, and 307 on a subsequent
HTTPS check. The route returning 502 points to a loopback backend that also
refuses a direct connection. Its configuration was not changed. No successful
before-restart response was recorded, so this record does not establish when
that other backend stopped. It was not repaired as part of this deployment.

### Owner setup now available

Open `https://cal.ryanmish.com/sign-in`. Obtain the first-owner setup code from
`/home/ryan/docker/icloud-calendar-mcp/secrets/enrollment` through a private host
editor or terminal. Do not send that code in chat or capture it in tool output.
Enter the actual iCloud address and a new service password. On the next secure
form, enter the separate Apple app-specific password, then select read calendars.
Never enter the primary Apple password. Keep credential entry user-controlled.

Use `https://cal.ryanmish.com/mcp` and OAuth when adding the private ChatGPT
connection. Current official setup is described in [test readiness](test-readiness.md).
The remaining live checks are owner login, actual iCloud discovery/reads,
ChatGPT authorization and refresh, cancellation, repair, and revocation.
The endpoint being reachable does not prove any of those account tests.

### Rollback

Stop only this project's services with the personal Compose file if needed.
Restore the protected tunnel backup and restart the same user service to remove
the calendar ingress rule. Remove only the newly added hostname's DNS route if
fully withdrawing public access. Preserve the database and service keys. Do not
alter the other tunnel routes or delete account data as part of a rollback.
