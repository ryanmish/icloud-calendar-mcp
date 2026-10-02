# Devbox setup with Cloudflare Tunnel

This guide describes the next setup phase. No live deployment has been done.
Use the existing named Cloudflare Tunnel. A temporary quick tunnel is not a stable
OAuth resource URL.

## 1. Configure OAuth

Use an OAuth provider with authorization-code flow, PKCE S256, discovery metadata,
and RS256 access tokens. ChatGPT supports predefined clients, dynamic client registration,
or client metadata documents as described in the
[OpenAI authentication guide](https://developers.openai.com/apps-sdk/build/auth).

An existing OIDC provider, such as Keycloak, can be used with a predefined ChatGPT client.
The provider must support the `resource` parameter and issue the matching audience.
Verify this in a token and in the full login flow; a valid ID token is not an access token.

Configure:

- Issuer: the exact `issuer` from provider discovery, including any trailing slash.
- JWKS URL: the provider's public signing-key endpoint.
- Audience: `https://calendar-mcp.your-domain.com/mcp`.
- Scopes: `calendar:read` and `calendar:write`.
- Subject: the immutable `sub` of the one user allowed to access this installation.
- Redirect URI: copy the exact callback from ChatGPT's connector management page.
- Token lifetime: short-lived access tokens; use the provider's refresh and revocation controls.

Do not use broad callback wildcards. Do not rely on `Sign in with Apple` to grant CalDAV access.
The calendar password remains separate. The server does not create OAuth clients or users.

## 2. Prepare configuration and the Apple secret

Copy `.env.example` to `.env`. Set the public hostname, issuer, JWKS URL, subject,
and Apple account email. Keep the calendar writes disabled until the read test passes.

Use a secure terminal or secret manager on the devbox to create
`secrets/icloud_app_password.txt`. Enter a new Apple app-specific password there.
Do not put the password in shell command arguments, command history, chat, or `.env`.
Apple requires two-factor authentication for this password.

The file must be owned by the container UID 10001 and have mode 0400 or 0600 on Linux.
The `secrets` directory should restrict access to the host administrator.
The container reads the file at `/run/secrets/icloud_app_password`.
Backups of this file are sensitive. Store them separately from the repository.

## 3. Build and start after configuration

```sh
docker compose build
docker compose up -d
docker compose logs --tail=50 calendar
```

Compose publishes the service only at `127.0.0.1:8000`. It runs without root,
with a read-only filesystem, no added capabilities, and resource limits.
The health endpoint reports process health only; it does not prove account access.

## 4. Add the Cloudflare route

Add the hostname to the existing tunnel's ingress rules. Use
`deploy/cloudflared.example.yml` as a reference. Do not overwrite existing ingress rules.
Route the public hostname to `http://127.0.0.1:8000` when cloudflared runs on the host.
If cloudflared runs in another container, use a shared Docker network and route to
`http://calendar:8000` instead. Loopback in that container is not the devbox loopback.

Preserve the Authorization header and support streaming HTTP. Bypass caching for this
hostname. Do not apply a Cloudflare browser challenge or interactive Access login to
MCP protocol routes. The service OAuth still protects all calendar tools.
Keep host administration protected separately. Add edge request limits.

Make discovery, the MCP route, and the identity provider reachable from ChatGPT.
The public MCP URL is `https://calendar-mcp.your-domain.com/mcp`.

## 5. Test and then enable writes

1. Check that `/health` works and unauthenticated `/mcp` returns an OAuth challenge.
2. Check protected resource metadata and confirm that its resource exactly matches the token audience.
3. Add the remote MCP app in ChatGPT developer mode and finish the OAuth flow.
4. Test `list_calendars`, `search_events`, and `get_event` with read access.
5. Set exact calendar IDs in `MCP_READ_CALENDARS` after discovery.
6. Create a separate test calendar in iCloud. Permit its ID in `MCP_WRITE_CALENDARS`.
7. Set `MCP_WRITE_OPERATIONS=["create","update"]` and restart the service.
8. Ensure the connection has both calendar scopes. Reconnect if the old grant has only read scope.
9. Test create retries with the same UUID, all-day dates, update ETags, and conflict rejection.
10. Confirm that the service rejects another calendar, another user, invitations, and recurrence changes.

Enable the desired normal calendar only after these checks pass. Do not test against
appointments that matter. A write is live even when a client loses the response.

## Stop and remove access

Use `docker compose down` to stop the service. Remove its tunnel ingress entry if needed.
Revoke the OAuth connection at the provider and revoke the Apple app-specific password
at `account.apple.com`. Remove the host secret when access is no longer needed.
