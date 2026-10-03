# iCloud Calendar MCP

A self-hosted iCloud Calendar service for ChatGPT and other remote MCP clients.
It uses iCloud CalDAV, OAuth, server-side write controls, and Cloudflare Tunnel.

**Status:** Personal setup flow implemented. Offline tests cover the calendar tools,
Better Auth code exchange and refresh, encrypted credentials, and access controls.
Live Apple login, iCloud access, ChatGPT connection, and devbox deployment are not yet verified.

## Tools

| Tool | Function |
| --- | --- |
| `get_profile` | Identify the permitted account connection |
| `list_calendars` | List readable calendars and enabled write operations |
| `search_events` | Read or search a window of at most 93 days |
| `get_event` | Read an event resource and its ETag |
| `create_event` | Create one timed or all-day event |
| `update_event` | Update one simple event with an ETag check |

Recurring events can be read. Their expanded occurrences share the resource event ID;
the `recurrence_id` identifies an occurrence. This version does not write recurrence,
invitations, RSVP responses, or deletions. Search reports truncation and skipped resources.
Free-time calculation and pagination are planned.

## Access controls

Each installation supports one iCloud account and one service owner.
OAuth grants access to this service. The Apple app-specific password grants the
service access to iCloud. These are separate credentials.

The service requires HTTPS configuration, signed tokens for its exact resource,
and `calendar:read`. Writes also require `calendar:write`, an exact writable calendar
ID, and an enabled operation. Writes are disabled until the operator sets that policy.
There is no unauthenticated mode. See [SECURITY.md](SECURITY.md).

## Develop

Use Python 3.12 or later and uv 0.12.22:

```sh
uv sync --locked --extra test
uv run --locked pytest -q
uv run --locked ruff check src tests
```

Tests use generated signing keys and fake calendars. They do not access real accounts.
The HTTP tests run in memory without a network listener.

## Host on the devbox

Start with the [personal setup guide](docs/personal-setup.md). It covers Apple
developer registration, secret files, migration, Cloudflare Tunnel, and ChatGPT.
Use `compose.personal.yaml` for the new guided flow. It adds a small Better Auth
service beside the existing Python server. The intended MCP URL is
`https://cal.ryanmish.com/mcp`. No live endpoint is claimed.

Sign in with Apple, then connect iCloud with its actual account address and an
app-specific password. The form prefills the address from `ICLOUD_USERNAME` or
your saved connection. It does not use the Apple relay email. You select calendar
rights before you approve ChatGPT. No separate service password is required.

The [original external-issuer guide](docs/deployment.md) and `compose.yaml` remain
available. Do not combine the two Compose files. Never enter Apple credentials
in chat. Test a separate calendar before enabling normal writes.

## Next work

See the [login and iCloud setup research](docs/onboarding-plan.md) for the
Better Auth flow, Apple registration questions, and private ChatGPT setup.

1. Complete secure Apple identity registration and host setup.
2. Verify the container and Cloudflare route on the devbox.
3. Verify login and calendar reads with ChatGPT.
4. Verify conditional writes in a test calendar.
5. Add free-time calculation, result pagination, and request limits.
6. Add separate user connections and isolation checks before shared hosting.

The current scope is a personal installation. Shared public hosting needs further work.

The Node service uses Node 24.16.0. Run `npm ci`, `npm run check`, `npm test`, and
`npm run build` from `web/`. Tests use fake credentials and an in-memory database.

## Sources and license

This service reuses CalDAV discovery and resource code from
[duanefields/dav-mcp](https://github.com/duanefields/dav-mcp).
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

- [Apple app-specific passwords](https://support.apple.com/en-us/102654)
- [OpenAI MCP authentication](https://developers.openai.com/apps-sdk/build/auth)
- [ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode)
- [FastMCP remote OAuth](https://gofastmcp.com/servers/auth/remote-oauth)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)

MIT license. This is an independent project. Apple and OpenAI do not endorse it.
