# Calendar test readiness

Date: 2026-10-09. This record separates local proof from a live connection.

## Verified this session

- Existing branch: `feat/personal-onboarding`. Local HEAD was `49919fe`.
- Local Reminders research changes were present and were preserved.
- 79 Python tests and 25 web tests pass after the first-login fix.
- Python lint, TypeScript checks, web build, and format checks pass.
- The production web and Python entry points start with temporary service files.
  The startup check verifies migration, the first-owner form, OAuth/PKCE/CIMD
  discovery, public verification keys, and refusal of unauthenticated MCP access.
  Private routes are blocked at the public listener. No owner, iCloud connection,
  or client grant is created. Temporary services and files are removed.
- The installed Better Auth CIMD validator accepts the documented transition
  metadata shape with plural supported methods and a singular `private_key_jwt`
  preference. The provider has signed-client assertion support. This is source
  and local validator evidence, not a real ChatGPT exchange.
- The existing devbox checkout is clean at `1ea3e56`.
- No project containers are running there. Port 3000 has no listener.
- No personal environment, service key files, or calendar database are present
  at `/home/ryan/docker/icloud-calendar-mcp`.
- `cal.ryanmish.com` did not resolve through the devbox resolver.
- The existing tunnel configuration has five ingress rules, including the final
  catch-all. No calendar hostname rule is present. Other routes were not changed.

The previous container builds cover the earlier implementation. A container
build for the first-login fix has not yet been run. Public TLS, Apple account
access, and the real ChatGPT client flow remain untested.

## First-login repair

Before an owner existed, the web handler compared an absent session user ID with
an absent owner ID. Both were undefined, so it attempted to show the owner
dashboard and refused the request. It now requires a session before that check.
A new test covers opening `/` and `/sign-in` without a session or owner.
The running-service startup check also covers this path.

## Proposed live test, awaiting owner approval

1. Transfer only the reviewed changes to the existing devbox checkout. Recheck
   local edits first. Build the changed container images there.
2. Create `.env.personal` from the template with password login and the existing
   hostname. Match file ownership to the non-root container user. Keep the actual
   account address in the browser. Leave writes disabled.
3. Create protected service keys with `scripts/init-personal-secrets.py`. Do not
   display their contents in chat or command output. Migrate the empty database
   and start the two Compose services.
4. Check health, discovery, refusal of unauthenticated MCP requests, and blocking
   of public private routes through `127.0.0.1:3000`.
5. Back up the existing tunnel configuration. Insert only this rule before its
   final catch-all, preserving all five existing rules:

   ```yaml
   - hostname: cal.ryanmish.com
     service: http://127.0.0.1:3000
   ```

   Validate it, add the DNS route to the existing named tunnel if absent, and
   reload that tunnel. A reload can briefly affect its other routes. Check the
   existing routes after the change. Keep OAuth enforcement on the service.
6. Verify public HTTPS, discovery, and refusal of calendar access without a token.
   Do not call the endpoint live before those checks pass.
7. The owner opens the secure form, obtains the host enrollment code privately,
   creates the service password, and enters an Apple app-specific password.
   Never enter the primary Apple password. Do not automate, capture, or log these
   form entries. First approve read access to selected calendars only.
8. Connect the intended `/mcp` endpoint from the owner's actual ChatGPT surface.
   Verify tool discovery, calendar reads, refresh, and client revocation.
   Do not enable writes until a separate test-calendar approval is complete.

This approval covers deployment and the exact hostname route. It does not grant
calendar data access, authorize writes, or configure email or Reminders.
If route validation fails, restore the backup. If public verification fails,
remove the new rule and stop the project services as appropriate. Do not delete
the protected database or keys during rollback.

## Current ChatGPT setup documentation

Official OpenAI documentation now describes **Plugins > plus > Add custom MCP
server**, then a URL and OAuth details. It documents CIMD and public-client or
signed-client token exchange. Use the matching controls on the owner's actual
client; old developer-mode labels in the original guide may differ. A GitHub
package or public directory submission is not needed for this URL setup.
Account availability and the selected callback remain part of the live test.

- [OpenAI remote MCP setup](https://developers.openai.com/api/docs/mcp)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)

## Run local proof again

Follow the development commands in [personal setup](personal-setup.md), then run:

```sh
.venv/bin/python scripts/smoke-personal.py
```

The local HTTP listeners are only for automatic startup checks. Do not use them
to enter real service or Apple credentials.

The separate [email research](email-research.md) does not delay this Calendar test.
