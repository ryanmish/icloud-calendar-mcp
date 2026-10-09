# Apple Reminders research

Date: 2026-10-05. Scope: research and design only.
No software was installed. No Apple data was read or changed. No permission,
credential, tunnel, or deployment setting was changed.

## Recommendation

Keep the current calendar server, Better Auth owner account, and MCP connection.
Add a Mac helper for Reminders. First evaluate `remindctl` as that helper's native
backend. Its released code already supports daily and weekly repeat rules.
Use the remote-agent pattern from RemindersBridge as a design reference.
Do not adopt a second hosted login service for the personal deployment.

This is a proposed design. These projects were inspected through their published
documentation and selected source files. They were not installed or tested with
this owner's Apple account. Source review is not a security audit.

## Why Calendar credentials do not settle Reminders access

The current server uses iCloud CalDAV for events. Modern iCloud Reminders has a
separate storage/access path. Finding an old CalDAV task collection does not
prove access to the lists in today's iCloud Reminders app.
[2Do's own integration guide](https://www.2doapp.com/docs/ios/sync-with-icloud-caldav/)
explicitly distinguishes its iCloud CalDAV tasks from Apple Reminders.
Apple documents separate upgraded iCloud reminders and unchanged other CalDAV
accounts in its [upgrade guide](https://support.apple.com/en-us/102457).
The Reminders app can still use other CalDAV accounts; that is a separate option,
not access to the owner's existing modern iCloud reminder lists.

Apple's [third-party authorization description](https://support.apple.com/en-us/121539)
names Mail, Calendar, and Contacts. It does not establish Reminders OAuth access.
No supported remote Reminders grant was found in the sources reviewed. Do not
promise that the calendar app-specific password or Calendar OAuth also grants
Reminders access. No live credential test was performed.

[EventKit](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)
is Apple's documented native access route. A Mac already signed in to iCloud can
read and change its synced reminder store through EventKit. The existing Linux
container cannot call this macOS framework.

## Existing projects

| Project | Verified useful parts | Limits for this project |
| --- | --- | --- |
| [openclaw/remindctl](https://github.com/openclaw/remindctl) | MIT; Swift/EventKit CLI, JSON output, list IDs, today/week views, create/edit/complete, alarms, daily and weekly repeats | macOS 14+; no remote MCP login layer. It also has delete and list-management commands that our adapter must block. |
| [IsaiahDupree/reminders-bridge](https://github.com/IsaiahDupree/reminders-bridge) | MIT; OAuth/PKCE remote MCP, paired Mac agent, outbound long polling, read/create/update/complete | JXA/Apple Events, with Automation permission. Published setup uses Vercel/Supabase and its own login. Reviewed tool schemas have no repeat-rule creation field. |
| [cleverdevil/iCloudBridge](https://github.com/cleverdevil/iCloudBridge) | MIT; Mac menu-bar app, EventKit REST API, selected lists, read/create/update/complete, remote bearer tokens | No ChatGPT OAuth layer. Reviewed reminder create/update signatures have no recurrence input. Localhost requests bypass authentication. |
| [FradSer/mcp-server-apple-events](https://github.com/FradSer/mcp-server-apple-events) | MIT; local MCP for both Calendar and Reminders; native CLI backend and permission handling | Current documentation makes recurrence/alarms read-only. Its checklist subtasks are stored in notes, not native Apple subtasks. It exposes calendar writes outside our permitted scope. |
| [eneko-codes/apple-reminders-mcp](https://github.com/eneko-codes/apple-reminders-mcp) | MIT; Swift/EventKit local MCP, permission/status tools, search/create/update/complete | macOS 15+; repeat creation omitted. A README statement that EventKit cannot create repeats conflicts with Apple's documentation and remindctl's source. |
| [HaobinZhou/OppenAppleBridge-MCP](https://github.com/HaobinZhou/OppenAppleBridge-MCP) | MIT; remote MCP via a Mac Shortcut, guided setup, HTTPS/OAuth option | Current tool table supports creation, not reminder search/update/completion or repeat creation. Its optional OpenAI tunnel path needs separate account availability. |

`remindctl` is the strongest fit for the requested daily/weekly tasks. Version
[v0.3.8](https://github.com/openclaw/remindctl/releases/tag/v0.3.8), published
2026-09-24, contains native `EKRecurrenceRule` writes in
[EventKitStore.swift](https://github.com/openclaw/remindctl/blob/v0.3.8/Sources/RemindCore/EventKitStore.swift).
The main branch also has recurrence parsing tests. This verifies source support,
not behavior on this owner's Mac. Pin the tested version before reuse. Preserve
MIT notices if code is copied or distributed.

Do not expose iCloudBridge directly through a localhost tunnel without an outer
authentication check. Its
[AuthMiddleware](https://github.com/cleverdevil/iCloudBridge/blob/0d88afb2224f08a10d2f92d46c82898c1461777e/Sources/iCloudBridge/API/AuthMiddleware.swift)
accepts loopback peers without a token. A local proxy can make remote requests
appear local. This is a concrete integration issue, not proof of an exploit in
an installed service.

Local MCP tools can work with local Codex clients. Installing a local stdio
server does not by itself add it to the existing hosted MCP URL. Official
[OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp)
distinguishes host configuration and hosted web tools. Remote, mobile, and
workspace support must be verified for the actual client surface.

## Supported actions and repeat behavior

Apple documents list enumeration, reminder fetches, title/notes/priority/due-date
changes, save, completion, and removal. See
[creating reminders](https://developer.apple.com/documentation/eventkit/creating-events-and-reminders)
and [completion](https://developer.apple.com/documentation/eventkit/ekreminder/iscompleted).
A due time and an alert are separate fields. The adapter must set an alarm if an
alert is requested. Date-only tasks must remain date-only.

Daily and weekly repeat rules are documented in
[Apple's recurrence guide](https://developer.apple.com/documentation/eventkit/creating-a-recurring-event).
Only the first incomplete reminder of a repeat set is available. Completing it
makes the next one available. A weekly view must not pretend that projected
future repeats are separate saved reminders. Date/time-zone handling needs tests
across daylight saving changes. See
[due-date components](https://developer.apple.com/documentation/eventkit/ekreminder/duedatecomponents).

Proposed first operations: read selected lists, create simple tasks, update basic
fields, complete a specific task, and optionally create a daily/weekly repeat.
Delete, list deletion, bulk writes, moving across accounts, sharing, invitations,
and changing existing repeat rules stay disabled. Native tags, sections, subtasks,
attachments, and Smart List configuration are not part of this first scope.
Do not convert unsupported native fields into notes without telling the owner.
Calendar recurrence writes remain disabled.

## Shared setup flow

1. Start from the existing MCP connection setup and sign in once with the service
   password. Keep calendar setup with its separate app-specific password.
2. Choose Reminders as an additional service. On the selected Mac, open a small
   helper with a stable app identity and explicit privacy text.
3. macOS asks for Reminders access. The owner approves it on the Mac. A web form
   cannot grant this device permission.
4. Pair that helper with the existing owner using a short-lived, single-use code.
   Keep its device credential in the Mac Keychain. No new user password or Apple
   password is needed for the helper.
5. Discover lists, show their account/source, and let the owner select permitted
   read lists, write lists, and operations. Confirm the intended iCloud source;
   service signup email does not prove that the Mac uses the same Apple account.
6. Review calendar and Reminders rights together and approve a new client grant.
   Old calendar grants receive no Reminders access automatically.
7. Return to the existing MCP client. Keep calendar and helper connection states
   separate so a missing Mac does not stop calendar calls.

A shared flow has one service account but separate Calendar credentials, macOS
privacy consent, helper pairing, and client authorization. Reminders setup can be
cancelled without granting access or removing working calendar setup. Expired
pairing requests must start again. Reconnect must preserve or reduce rights;
it must not select new lists or restore revoked client grants.

## Permissions and availability

EventKit requires full Reminders access even to read. Apple does not offer a
read-only Reminders grant through this API. On a macOS 14+ target, use
`requestFullAccessToReminders` and `NSRemindersFullAccessUsageDescription`.
For a sandboxed helper, review Apple's required EventKit entitlement setup.
The existing CalDAV calendar path does not require a new macOS Calendar grant.
No Full Disk Access, Accessibility, Contacts, or location access is needed for
this proposed basic EventKit scope. A JXA backend instead needs Automation access.

The broad macOS grant is separate from our list and operation restrictions.
Enforce host limits, current owner policy, and frozen client grant limits on the
server; enforce local helper limits before each operation too. Proposed scopes:
`reminders:read` and `reminders:write`, with separate per-operation flags including
repeat creation. Stop requests if macOS consent, pairing, or the client grant is
revoked. Revoking a client grant must not delete its reminders.

No Apple Calendar OAuth registration is needed for native EventKit access.
Apple documents free local development/testing through Xcode in its
[developer account guide](https://developer.apple.com/help/account/basics/about-your-developer-account).
Signing and privacy behavior must be tested with the selected helper. Rebuilds
can cause a new permission prompt. Public notarized distribution is a later,
separate decision; do not require a paid membership for a personal prototype.

## Synchronization limits

The helper reads the Mac's synced local store. iCloud synchronization is managed
by macOS; successful local save is not confirmation that every device has received
it. The Mac and other devices need the intended Apple account and Reminders sync
turned on. See [Apple's setup guide](https://support.apple.com/guide/icloud/set-up-reminders-mmbf52194b5a/icloud).

The helper must be running and reachable for new MCP calls. When the Mac sleeps
or goes offline, fail writes promptly. Do not queue them for unexpected later
execution. Reminders already saved can still work and alert on other synced
Apple devices. A due date or native repeat does not require a daily ChatGPT run.
Automatically generating fresh daily/weekly plans would require a separately
approved scheduling feature.

Apple's [store-change notification](https://developer.apple.com/documentation/eventkit/ekeventstorechangednotification)
does not describe individual changes. Refetch after changes and reconnect.
Apple also warns that [item IDs](https://developer.apple.com/documentation/eventkit/ekcalendaritem/calendaritemidentifier)
and [list IDs](https://developer.apple.com/documentation/eventkit/ekcalendar/calendaridentifier)
can be lost after a full sync. If an approved list ID disappears, refuse writes
until the owner selects it again. Do not match a list only by its display name.

Use durable request IDs, exact targets, and a pre-write revision check. EventKit
has no CalDAV-style HTTP ETag precondition; a compare-before-save check does not
remove all concurrent-edit races. Return conflicts rather than overwrite without
review. Repeated completion of a recurring task must never complete its next
instance. A timed-out save can have succeeded; report an unknown outcome and
reconcile before a retry. Do not use display indexes as remote task identifiers.

## Changes needed in this repository

Verified current code:

- `vendor/caldav.py` lists event collections by default.
- `service.py` parses `VEVENT`, not Reminders tasks.
- `web/src/auth.ts` advertises calendar scopes only.
- `web/src/store.ts` and the private bridge implement calendar connection and
  grant checks. These controls are reusable but need a separate Reminders state.

Proposed implementation order:

1. Test pinned remindctl on a dedicated iCloud list with owner-granted permission.
   Verify read, create, complete, daily/weekly recurrence, due dates, and iPhone sync.
2. Build a narrow Mac adapter with explicit IDs, JSON results, bounded subprocess
   calls, no shell interpolation, per-list limits, and safe replay handling.
3. Add secure outbound helper pairing/connection to the existing service. Keep
   native operations behind this channel and keep device credentials private.
4. Add separate scopes, policy fields, connection state, and setup/dashboard views.
   Update token/private-access checks for each service without expanding old grants.
5. Add MCP task tools and test revocation, helper loss, interrupted setup, stale IDs,
   concurrent edits, and repeat completion retries. Test with ChatGPT only after
   these checks pass. Preserve the existing calendar restrictions.

## Decisions that require the owner

- Which Mac will run the helper, and whether it can stay awake for remote calls.
- Which existing or test iCloud lists can be read and written.
- Whether writes include create, update, completion, and daily/weekly repeat creation.
- Whether "daily and weekly tasks" means repeating tasks, planning views, or fresh
  task generation. The proposed default is native repeats plus today/week views.

The owner must grant the macOS permission and approve the final client rights.
No approval to install, pair, grant permissions, or change reminder data is
inferred from this research request.
