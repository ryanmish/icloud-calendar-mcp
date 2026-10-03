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

## Login prerequisite

The owner has confirmed that no Apple Developer account is available.
The current code requires Apple identity developer settings and a signing key.
It cannot complete Apple login with a normal consumer Apple account alone.

Apple's [web login setup](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)
requires a Services ID linked to a primary Apple-platform App ID. Apple lists
Developer Program membership at US$99 per year, with regional prices and possible
fee waivers in its [enrollment guide](https://developer.apple.com/programs/enroll/).
Membership alone does not prove eligibility for a standalone web-only service.

The owner must choose whether to keep Apple login and complete registration, or
use a service passkey for this personal version. A passkey can be stored in Apple
Passwords/iCloud Keychain, with no separate service password. It is a separate
service credential and does not prove Apple identity. Better Auth supports a
[passkey plugin](https://better-auth.com/docs/plugins/passkey). Apple documents
[passkey security and iCloud Keychain](https://support.apple.com/en-us/102195).
The passkey alternative is not implemented or deployed at this point.

Both paths keep iCloud access separate. The app-specific password must be entered
through the secure setup form. Do not put it in chat, shell arguments, logs,
source control, screenshots, or URLs.

## Next steps

1. Resolve the login choice and complete its code and secure setup.
2. Prepare protected service files and the host environment. Keep the actual
   iCloud address in the protected host setting for the form prefill.
3. Migrate the database and start the two project services with writes disabled.
4. Verify the private service checks and denial of unauthenticated MCP calls.
5. Prepare and validate the exact tunnel rule. Preserve the existing routes.
6. Verify public HTTPS, OAuth discovery, owner setup, and a ChatGPT connection.
7. Test reads first. Enable writes only for a selected test calendar after a new
   approval. Keep delete, invitations, RSVP, and recurring-event changes disabled.

Do not mark a step complete without its verification result. Store only
non-secret results in this record.
