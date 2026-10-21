# cPanel email adapter research

Date: 2026-10-09. This is a proposed extension, not an active connection.
No mailbox credential was configured. No mail server was contacted.
No messages were read, changed, or sent.

## Recommended first version

Keep the existing service owner, Better Auth login, and MCP endpoint. Add a
separate email connection and a read-only IMAP adapter. Start with folder
selection, bounded search, message summaries, and reading a selected message.
Do not enable sending, drafts, flags, moves, deletion, or attachment downloads.
Calendar consent must not grant email access.

cPanel documents IMAP over TLS on port 993. The normal username is the full
mailbox address and the credential is that mailbox's password. Use the exact
server and TLS settings from **Email Accounts > Connect Devices**. Certificate
status can change the recommended hostname; do not guess it from the address.
The installed server's settings remain unverified.
[cPanel mail-client setup](https://docs.cpanel.net/cpanel/email/set-up-mail-client/)

A cPanel API token authenticates cPanel API calls. It is not documented as an
IMAP mailbox password. This adapter needs no WHM/root/cPanel administration token.
Whether this installation has mailbox OAuth or a separate application password
remains unknown. Do not assume cPanel web-login two-factor authentication provides
either feature for IMAP.
[cPanel API tokens](https://docs.cpanel.net/knowledge-base/security/how-to-use-cpanel-api-tokens/)

## Existing implementations

These findings come from current project documents and selected metadata.
No project was installed, account-tested, or security-audited.

| Project | Useful existing work | Limits for reuse |
| --- | --- | --- |
| [ni-c/imap-mcp](https://github.com/ni-c/imap-mcp) | Node/ImapFlow; read/search tools; no sending; mailbox write tools off by default | Local stdio needs our remote authorization layer. Its documented new-mail tracking writes an `AiSeen` keyword by default, despite read-tool labeling. Disable that tracking or omit the tool for a strict read-only adapter. Attachment resources need separate policy checks. |
| [rafaelreverberi/Mail-MCP](https://github.com/rafaelreverberi/Mail-MCP) | IMAP/SMTP; bounded reads; remote OAuth/OIDC mode; write confirmation workflow | Adds another application and Redis. SMTP and broad write tools exceed the proposed first scope. |
| [wildsurfer/your-mail-mcp](https://github.com/wildsurfer/your-mail-mcp) | Read-only indexed mail with authenticated HTTP; mbsync/notmuch | Maintains a full local mirror and its own consent/password model. More storage, retention, and sync work than a first live IMAP adapter. |

Evaluate the maintained [ImapFlow library](https://imapflow.com/docs/api/imapflow-client/)
for a narrow private adapter instead of replacing the existing authentication
service with a complete second MCP application. It supports mailbox locks,
read-only opening, UID fetches, and connection notifications. Pin a reviewed
version during implementation. The library does not provide our owner policy.

## Read-only behavior and synchronization

Use `EXAMINE`, or the library's read-only mailbox option. Fetch with `BODY.PEEK`
to preserve unread state. Block `STORE`, `APPEND`, `COPY`, `MOVE`, and `EXPUNGE`.
Do not add tracking keywords. A normal mailbox password may permit writes at
the mail server; our adapter must enforce the smaller approved scope. Server-side
read-only credentials or ACLs are optional further limits if the host supports them.

Identify each message by connection, folder, UIDVALIDITY, and UID. A UID alone
is insufficient. Reconcile after reconnect and invalidate stale identifiers when
UIDVALIDITY changes. Moving a message can change its folder and UID. Threading
needs message headers or a supported server extension, not assumptions based
on a subject line. IDLE notifications require a maintained connection and do not
replace reconciliation. Check server capabilities before optional extensions.
[IMAP standard](https://www.rfc-editor.org/rfc/rfc9051.html)

Start with on-demand reads. Use search time windows, result limits, partial body
fetches, byte limits, timeouts, and bounded MIME parsing. Do not create a complete
mail archive by default. Returned messages are visible to the requesting MCP
client; self-hosting the adapter does not keep those results out of ChatGPT.

Sending requires a separate SMTP operation and explicit authorization. It is not
part of IMAP read access. SMTP acceptance is not final delivery, and saving a copy
in Sent is a separate operation. Research that later if requested.

## Shared setup and code plan

1. Add an email-specific connection record, encrypted mailbox secret, pinned
   administrator-approved server, and allowed folders. Keep Calendar state separate.
2. Extend `web/src/auth.ts` with an explicit `email:read` scope and update grant
   records and private access checks. Do not expand existing Calendar grants.
3. Add an email setup view under the current owner session. The owner enters the
   mailbox password only in a secure browser form. Test TLS, authentication, and
   folder discovery before explicit folder/client consent. Keep passwords out of
   URLs, chat, logs, screenshots, and source control.
4. Add a private adapter worker and email tools to the existing MCP surface.
   Resolve the account from verified authorization, never a model-supplied address.
   Enforce host, connection, and frozen client limits before each mailbox operation.
5. Treat mail text and headers as untrusted data. Convert HTML to bounded text;
   do not load remote images or links. Message contents cannot approve a calendar
   write or an email operation. Deny attachment access initially.
6. Pin the mail host and port in host configuration. Mail servers can use private
   addresses, so approve that exact destination rather than accepting arbitrary
   browser or tool URLs. Verify TLS certificates and deny insecure fallback.
7. Test unread-state preservation, denied folders, revoked grants, timeouts,
   UIDVALIDITY changes, malformed MIME, and hostile message text with local fakes.
   Use a selected test mailbox for an owner-approved live check later.

Disconnecting email must remove its active credential and stop only email grants.
Mailbox password rotation must require repair without restoring revoked rights.
Keep the one-owner deployment. Multiple users need a separate isolation design.

## Owner involvement later

The owner must select the mailbox and permitted folders and confirm the exact
TLS hostname from cPanel. Confirm whether its ordinary mailbox password is
acceptable or whether a separate credential can be provided by the installed
server. Enter credentials through the secure setup page, never in chat.
These steps are not required to finish the Calendar test.
