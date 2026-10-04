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
