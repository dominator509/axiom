# Model-scoped human roles — implementation queue

## Owner member GUI checkpoint — M323

Owners can now discover `/members` through primary navigation, load paginated
workspace members and review/confirm role changes. Non-owners see an access
explanation and no administration controls. The client sends the expected current
role, retains the exact idempotency key/payload after uncertain responses, fences
double clicks and validates the saved member identity/role. Terminal conflicts
require reload rather than silently overwriting another edit. Confirmation warns
about session revocation and self-demotion; the API remains the authority for
last-owner protection. Sixteen focused GUI tests, typecheck and lint pass (three
pre-existing lint warnings). No real member was edited, and deployed desktop/mobile
acceptance and staged-role activation remain open.

## Owner member API checkpoint — M322

Authenticated owner member discovery and role mutation are now mounted in the API.
Discovery uses tenant-scoped cursor pagination and returns only member ID, name,
email and role. Both routes recheck stored owner authority; mutations require an
idempotency key and expected prior role. Real PostgreSQL coverage checks paging,
foreign cursors/targets, stale authority, conflicting edits, last-owner protection
and session revocation. The application entry rejects unauthenticated discovery
and mutation before handler work. All 148 focused API tests, 36 PostgreSQL tests
after 48 migrations and API typecheck pass. No live member was changed. The owner
GUI and scoped-role activation remain incomplete and are the next implementation
steps; this is not deployed acceptance evidence.

## Owner role-control checkpoint — M321

The role-change transaction service now supports the currently enabled human roles
(Owner, Manager, Operator and Analyst). It rechecks current owner authority and
tenant membership, rejects stale expected-role edits, protects the last owner
under concurrent demotions, revokes target sessions and writes the audit in the
same transaction. Thirty-six real PostgreSQL tests after 48 migrations and API
typecheck pass. No actual workspace member was changed. This service still needs
its owner-only API and GUI; scoped-role authentication activation remains a
separate incomplete step, not silently enabled by assignment or role controls.

Authority: L1.0 personas/RBAC and L1.1 F-24–F-26.
Status: **in progress**. Assignment storage, owner-only grant/revoke/list API and
Team-page controls are implemented. Staged role enforcement now covers discovery,
counts, direct model reads, bundle reads and media previews with a default-deny
read allowlist. Remaining nested resources,
mutations, scoped navigation and the live DM workflow remain incomplete; deployed
browser acceptance is pending. Normal authentication rejects staged roles rather
than treating them as unrestricted null-role sessions until the policy is complete.

Migration 0045 adds user/model assignments with composite organization foreign
keys, forced tenant RLS and explicit grant/revoke semantics (no runtime UPDATE).
Parent tenant changes require removing existing assignments first. No existing
account role is changed and no new role is accepted by authentication yet: the
current workspace-wide read behavior must be replaced before enabling them.

The staged `enforceModelAccess` boundary is mounted after session resolution and
before REST handlers. Model discovery/count/detail queries filter assignments
inside SQL (before pagination). Chatter queries additionally require an active
shift for the exact organization/model/user and a half-open time window evaluated
by PostgreSQL. Unknown route shapes, nested-ID routes and all mutations remain
denied for staged roles until their explicit policies are implemented. This is an
incomplete implementation, not a completed Chatter/Creator workflow.

Bundle lists filter assignments before pagination; direct bundle IDs resolve
through owned records. Gallery and bundle preview queries independently recheck
assignment membership before opening files. Real PostgreSQL acceptance exercises
temporary PNG byte delivery and range responses, foreign model/tenant denial,
and revocation. Chatter cannot read these media paths. Creator approval and other
mutations remain denied; roles are still not activated in normal authentication.

Fan list and direct timeline reads now recheck the contact's model assignment
inside SQL. Model and Chatter may read their scoped CRM; Creator cannot. Chatter
requires the same active shift on direct fan IDs. Timeline requests must match
both the fan and its model, and all child records retain explicit tenant scope.
Real PostgreSQL tests cover active/expired shifts, revoked membership, another
model/tenant and mismatched request references. This is saved CRM read access,
not live inbox synchronization or permission to send messages.

Creator preparation now has an explicit assigned-model allowlist: POST generation,
upload and media operations; GET source-image choices, operation status and saved
playbook guidelines. Generation/model and asset queries repeat assignment scope.
The operational-role middleware accepts Creator only after the central allowlist.
Real PostgreSQL tests exercise text-only generation plus ToS enqueue and an owned
image transform enqueue, without running workers or providers. Approval, direct
publishing, standalone bundle staging, schedule changes and retry endpoints remain
denied until individually implemented. Normal login still rejects staged roles.

Creator POST `/bundles` now permits staging after the validated body model's
assignment is checked in the creation transaction. Existing asset/variant ownership
and byte verification stay intact. Server-owned generated state and pending media
ToS cannot be overwritten by client fields; only a ToS scan is queued. Tests prove
unassigned models, mismatched assets and revoked membership cannot stage bundles.

Scheduler inspection: POST `/posts` creates publishing jobs; PATCH may change
destination/timing. Do not simply expose these to Creators. The next scheduler
step should use the existing bundle `publishIntent` and approval flow for an
explicit reviewable schedule request, with revision protection and GUI disclosure.
Approval remains a separate authorized action. Legacy approved-bundle scheduling
does not by itself prove a Creator-specific approval contract.

New media review bundles now accept an optional future `scheduleRequest` tied
to a caption destination. It persists as the existing schedule `publishIntent`,
without approval/publication jobs. Media staging UI converts local time via the
existing DST-aware parser and verifies the saved intent receipt. Approvals show
the requested UTC time and explain blank-slot use versus explicit override.
This implements proposing timing during bundle creation; editing existing
requests and restricted-role navigation are still unfinished. Existing approval
code rejects stale/past timing before dispatch. Real provider approval remains
unexercised here; tests use isolated storage and DB only.

Shared primary navigation and talent tabs now receive the server session role
for both desktop and mobile. Owner-only settings/network/agent destinations are
hidden from other roles. Restricted roles get explicit destination lists, unknown
roles get minimal navigation, and Creator approval navigation says Review drafts.
These presentation rules are not authorization. Profile shortcuts, individual
page queries/actions and direct-page denied states still need alignment before
activating the roles; no claim of complete frontend role support is made yet.

The review queue now resolves the session before loading resources. Creator,
Analyst and Agent views retain drafts/media/pagination but do not query social
connections or render approval, revision, retry, adaptation or compliance-review
mutations. Excluded roles get a useful denied page without resource requests.
Twenty-five page tests and dashboard typecheck pass; deployed browser acceptance
and remaining profile/page controls are still open. Roles remain inactive until
the full authorization and user workflow is implemented.

The profile overview now shares the destination policy with navigation: network
summary requests and links are owner-only, scoped calendar/fan requests are made
only when allowed, and workspace shortcuts exclude unavailable sections. Failed
profile loading stops secondary requests. Thirteen overview tests plus dashboard
typecheck pass. Individual generation/media/calendar/playbook action controls and
deployed role-specific browser acceptance remain to be reconciled.

Media library now permits assigned Creator transform/staging controls without
exposing the unsupported variant-creation endpoint. Model viewers do not request
operation history; read-only roles retain previews/pagination without generation
shortcuts. Gallery and operation-history failures are independent, preventing a
denied history request from hiding valid media. Failed history suppresses new
transform controls until refresh. Ten page tests and typecheck pass; generation
page and its nested controls still require the role reconciliation pass.

Generation page now allows operational roles and Creator only. Creator progress
keeps previews and review-draft links without operator retry/incident controls;
scan failures direct them to an operator. Forty focused tests and dashboard
typecheck pass. The embedded Grok connection uses `/api/v1/llm/subscriptions/grok`:
Creator own-user sign-in/status/cancellation requires an explicit central policy
and gateway ownership verification before role activation. Do not expose storage
administration or arbitrary gateway mutations by allowing the whole prefix.

Creator own-user Grok lifecycle now has exact method/path allowlisting for status,
disconnect, resumable login creation/latest/status/cancellation. Authentication
still requires both user and workspace; the gateway derives credential ownership
only from user context. UUID attempt paths are explicit; storage, legacy login,
other providers and generic gateway calls remain denied. Ten policy/boundary
tests and 37 gateway lifecycle tests pass, including cross-user observation and
cancellation denial despite supplied body/query identities; both typechecks pass.
These tests do not dispatch a real provider login. Roles remain staged pending
the rest of the workflow and deployed acceptance.

Calendar role reconciliation preserves month navigation and scoped posts. Model
viewers do not request inaccessible guideline/week data or see review/team-note
controls. Creators see cadence, drafts and guidance to propose timing through
media staging rather than direct post mutation. Excluded roles load no calendar
resources. Twelve page tests and typecheck pass. Creator internal collaboration
notes are still a missing capability to implement with explicit model assignment
checks; hiding the unsupported control does not complete that requirement.

Creator post-linked collaboration notes are now wired back into calendar cards.
Exact GET/HEAD/POST note routes resolve the assigned model; both read and write
handlers repeat assignment checks inside their transaction and retain joined
post/model/tenant ownership and authenticated author attribution. Workspace
member/shift administration remains denied. Twenty-five real PostgreSQL tests
after 46 migrations pass, including cursor traversal, foreign post/model/tenant
denial and revoked reads/writes; the disposable database was removed. Twenty API
unit/policy tests, twelve calendar tests and API typecheck pass. Full model-note
history, shift views and deployed browser acceptance are still unfinished.

Creator playbook score GET/HEAD now resolves assigned talent; the score handler
checks model ownership/membership before deriving results. Guideline/current and
history queries repeat assignment predicates. The page excludes disallowed roles
before queries and keeps Creator guidelines read-only. Twenty-six PostgreSQL
tests after 46 migrations pass with foreign-model/tenant, denied writes and
revocation checks; fixture cleanup confirmed. Seven score tests, six page tests
and API/dashboard typechecks pass. This validates access wiring, not the accuracy
of the legacy course-adherence proxy metrics or deployed browser acceptance.

Self shift roster API: authenticated GET `/api/v1/my-shifts` returns only the
current user's shifts in the current org and currently assigned models, sorted
by start time/id with scoped cursor pagination. Chatter may read upcoming roster
entries without gaining model/DM access before an active shift. No coworker list,
emails or credentials are returned; assignment revocation removes roster access.
Twenty-seven PostgreSQL tests after 46 migrations pass, including tied-time
pagination, another assignee/model/tenant, cursor ownership and early model denial.
API typecheck and 88 policy/registration tests pass. Personal roster frontend and
shift-state UX are next; this endpoint alone does not complete F-26.

Personal `/shifts` page is now linked in desktop/mobile primary navigation for
Chatter and operational roles. It reads the self-roster API, shows UTC windows,
recorded status, escaped handoff notes, pagination and manual refresh. Only an
active in-window row offers the assigned CRM link, with explicit recheck and
non-live-inbox disclosure. Invalid/future/ended/closed windows offer no such link.
Thirty-eight page/navigation tests, dashboard typecheck and lint pass (three
existing explicit-any warnings). Live DM implementation and deployed browser
acceptance remain open; new roles are still not enabled in authentication.

Saved fan CRM custom-request list now permits Model and active-shift Chatter
reads for assigned talent. The central route boundary and query-level assignment
predicate both apply; Creator remains excluded and no ticket mutation is enabled.
Fan page rejects excluded roles before requests while Model/Chatter see saved
contacts and tickets without editing controls. Twenty-seven PostgreSQL tests
after 46 migrations verify foreign-model/tenant, expired-shift and revoked reads;
fixture removed. Twenty-eight API tests, fourteen page tests and both typechecks
pass. This remains saved CRM, not live DM synchronization; analytics supplemental
routes and the remaining role activation workflow are still open.

Analytics supplemental reads now permit assigned Model/Creator viral insights
and monthly PDF downloads. Analytics raw SQL/count, viral distributions/top rows,
and report model selection repeat assignment predicates; excluded dashboard roles
issue no requests. Twenty-nine PostgreSQL tests after 46 migrations pass with
real PDF signature, cross-model/tenant, Chatter denial and revocation coverage;
fixture cleanup confirmed. Twelve route tests, four page tests and both typechecks
pass. Inspection found monthly report metrics still sum cumulative snapshots,
unlike dashboard latest-snapshot aggregation; correct that separately before
claiming report metric accuracy. Role activation and live acceptance remain open.

Monthly repeated-snapshot defect corrected: one latest observation per post in
the selected half-open month, with deterministic timestamp/id ordering, is summed
for each counter. PDF discloses cumulative-not-period-earned semantics and that
saved sources may be manual/legacy. Thirty real PostgreSQL tests after 46
migrations pass; PDF bytes verify 100 then 140 views yields 140, excluding next
month and another model. Three report tests and API typecheck pass; fixture
removed. This does not establish provider metric completeness or resolve other
legacy score semantics. Role activation and deployed acceptance remain open.

The authenticated `/api/v1/models/:modelId/member-assignments` API provides
cursor-paged GET and idempotency-protected POST (`{ userId }`); DELETE of
`/:assignmentId` revokes one grant. Owner checks apply to all methods, including
reads. Grants/revocations and audit entries commit together. Repeated/concurrent
grants return the original assignment without duplicating the audit. No endpoint
changes account roles, and these assignments alone do not reduce or expand the
legacy workspace roles' permissions. The Team page states this distinction,
offers paginated loading, explicit revocation confirmation and stable retry
intent, and never displays the assignment controls to non-owners. Account role
editing must stay unavailable until the complete role policy is installed.

Current evidence (2026-09-17): core UserRole and auth session validation recognize
owner, manager, operator, analyst and agent only. Team shifts record human queue
assignments; they do not authorize DM access. The fans page explicitly describes
saved interactions, not a synchronized live inbox. Do not advertise those as the
Chatter workflow.

Implementation sequence:

1. Define additive `chatter`, `content_creator`, `model` roles without silently
   changing existing accounts. Add org-scoped user/model assignments, managed by
   owners, and validate both users and models belong to that organization.
2. Enforce a central default-deny permission matrix for these roles at API entry.
   Filter model discovery and global lists. Resolve nested asset, bundle, post,
   fan and preview IDs to their model before authorizing; URL hiding is not access
   control. Retain existing org RLS and agent capability-token boundaries.
3. Chatter: assigned model AND active assigned shift within its time window,
   DM operations only. Deny network, billing, generation and publication.
   Content Creator: assigned model assets/generation/staging/scheduler controls,
   no direct approval/publication or credentials. Model: own assigned dashboard,
   calendar, analytics, earnings and fan CRM reads only. Blueprint ambiguity must
   not grant mutation merely because a panel is visible.
4. Owner-facing assignment/role management and self-scoped team/shift views;
   role-aware navigation with useful denied/expired-shift states. Never show
   workspace-wide membership or credentials to restricted roles.
5. Inventory existing Fanvue messaging tools and webhook ingestion. Implement the
   actual supported-provider inbox/send/handoff path with message attribution,
   stable send intent and uncertain-delivery handling. Verify current official
   provider contracts before implementation. A free-text queue label or saved
   interaction note does not complete DM-queue assignment.
6. Prove cross-model IDs, cross-tenant IDs, list leaks, revoked assignments,
   expired shifts and privileged-route denial using real PostgreSQL plus route
   tests. Browser acceptance requires separately signed-in restricted accounts
   on the deployed exact revision. No live DM is sent without an approved test
   recipient and message.

## Earnings contract groundwork (M302, 2026-09-17)

The L1 Model persona explicitly requires own earnings. Source inspection found
only an unconsumed permissive MCP client method; no earnings API/page/storage.
The official https://api.fanvue.com/docs/openapi.json self-summary contract was
retrieved on 2026-09-17. The versioned Fanvue connector now implements the read
through its injected transport (the worker binds that transport to model egress),
validating totals, source breakdown, timeline and period. Unknown fields are
discarded, missing/malformed money fails instead of becoming zero, and nullable
percentage comparisons remain nullable. Amounts stay in USD cents. Provider net
excludes platform fees but does not subtract reversals; it is not payout balance.
36 focused connector tests and connector typecheck pass. These are contract
fixtures, not live provider evidence.

Next: exact org/model/connection selection and assignment checks in an API route,
owner/manager/model financial visibility, explicit unavailable/reconnect handling,
and a reachable earnings page with the above disclosures. No frontend should use
the MCP client's unvalidated object or invoke a host-direct provider fetch. Live
OAuth scope, financial values and browser acceptance remain unverified. No
account role, deployment, provider state, or social publication changed.

## Earnings API boundary (M303, 2026-09-17)

`GET /api/v1/models/:modelId/earnings` now exposes active Fanvue account choices
without decrypting or contacting a provider. An explicit `connectionId` reads
the validated provider summary through the worker's existing credential and
healthy-model-egress boundary. Owner/Manager and assigned Model may read; other
roles are denied. Query predicates repeat org/model/assignment/platform/status
checks. Model access and connection presence are rechecked after provider latency;
responses are private/no-store and upstream failures never become zero earnings.
The API returns cents, currency and observation time without credential envelopes.

27 route/policy tests, API typecheck, connector/worker builds and 31 real PostgreSQL
tests pass after 46 migrations. The first PG run rejected a test fixture's invalid
`disconnected` status; corrected it to the schema's `revoked` without weakening
the production check. Disposable fixture `axiom_workspace_test_9938506ee4dd53a6`
was removed. The PG checks exercise account discovery and denied selections, not
an authenticated provider response. No live provider call or deployment occurred.
Earnings GUI, explicit financial disclosures, live OAuth/egress/account acceptance
and full new-role activation still remain; this API is not feature completion.

## Earnings surface (M304, 2026-09-17)

Owner/Manager/Model now have an Earnings talent tab. The server page guards roles
before fetching accounts; an explicit GET-form choice triggers the selected
account read. No background polling or automatic first-account selection occurs.
Errors preserve usable account choices without rendering zero earnings. Empty
accounts, forbidden access, unknown selection and loading have distinct states.
The page shows all-time/current/prior-month gross and net, nullable comparisons,
source breakdown and an expandable timeline. USD-cent conversion, provider period,
observation time, rewards, fees/reversals and non-payout semantics are disclosed.
Shared grid/stack/action styles and scroll-contained timeline support narrow screens.

40 page/navigation tests, dashboard typecheck and lint pass (three pre-existing
test warnings). The page tests were rerun after the typed card-layout cleanup.
These are rendered-markup tests, not authenticated mobile/desktop acceptance.
No deployment or provider call occurred. Financial account values/scopes and
role activation remain live acceptance requirements. The original full feature
reconciliation, including DM operations and all runtime gates, is still open.

## Live inbox contract groundwork (M306, 2026-09-17)

Retrieved official Fanvue OpenAPI `/chats` and `/chats/{userUuid}/messages`
contracts from https://api.fanvue.com/docs/openapi.json. Added bounded typed
reads to the existing injected-transport Fanvue connector; the former permissive
MCP inbox method is not used as authority. Page/size and counterpart UUID are
validated before network access, and response shapes/page counts are validated.
`markAsRead=false` is always supplied: the provider defaults this to true, so
omitting it would make inspection silently change unread state. Chat `isRead`
remains authoritative even when unreadMessagesCount is zero. Sender attribution,
message type, paid-content amounts/purchase status, media IDs and GIF identity
are retained; third-party GIF hotlink URLs are not forwarded to the browser.

53 focused connector tests and connector typecheck pass. No live inbox read,
read receipt, message dispatch or provider login occurred. Next: exact account
selection and assignment/active-shift checks in API reads, then inbox/navigation
and controlled reply delivery with durable intent/uncertain-result handling.
Attachment delivery needs an authorized media path, not direct third-party URLs.
Agentic drafts, ingestion, queues, send attribution and SFW gating remain in scope.

## Live inbox API reads (M307, 2026-09-17)

Added `/api/v1/models/:modelId/inbox`: account choices without provider access,
then explicit connection selection for chat pages or counterpart message pages.
Inputs are bounded; encrypted credentials and healthy model egress use the
existing worker connection adapter. The response is private/no-store, never
serializes the credential row, and errors are generic rather than empty inboxes.
Owner/Manager/Operator may read within their org. Model needs an assignment;
Chatter needs that assignment plus an active in-window shift. Creator and legacy
agent API access are denied; MCP capability-based integration remains separate.
Assignment/shift and active connection are checked again after provider latency.
No API mutation, mark-read operation or reply delivery is enabled by this work.

27 route/policy tests, API typecheck, connector/worker builds and 32 actual
PostgreSQL tests pass after 46 migrations. A fresh Chatter fixture proves no
access before a shift, own-account discovery while active, foreign model/tenant
denial, expiry denial and assigned Model access independent of a chatter shift.
Fixture `axiom_workspace_test_d10ad2794e58eff7` was removed. No provider was called.
Next remains inbox GUI, authenticated provider/browser evidence, attachment proxy,
durable reply intent/delivery/reconciliation, agentic drafts and sync/queue work.

## Inbox read surface (M308, 2026-09-17)

Added the role-filtered Inbox talent tab and active-shift shortcut. The page
requires explicit account selection, offers paged conversations and message
history, preserves account/counterpart context on navigation, disables prefetch
on provider-read links, and uses explicit refresh instead of background polling.
Unread status is independent of the unread count; sender, source type, team/app
attribution, payment/purchase and attachment labels are visible. Provider text
is rendered as escaped text, not HTML. No external GIF/image hotlinks are loaded.
Loading, denied/expired access, empty results, stale selections and upstream
failure are distinct. Existing responsive card/action styles are reused.

52 inbox/navigation/shift tests and dashboard typecheck pass; lint has only the
three existing test warnings. A test query helper needed its undefined optional
keys reflected in its type; fixed after typecheck caught it. This is markup/unit
evidence, not authenticated browser acceptance. The page explicitly states reply
delivery and attachment previews are unavailable; these remain implementation
requirements, not waived features. No live request, read receipt, send or deployment.

## Text reply provider contract (M309, 2026-09-17)

Retrieved official Fanvue OpenAPI `POST /chats/{userUuid}/message`: text 1..5000
characters and HTTP 201 `{messageUuid}` receipt. No idempotency parameter/header
is documented on this operation. Added exactly-one-attempt text reply to the
existing connector; recipient/text validation and credential refresh precede
dispatch, approved whitespace is preserved, and successful receipts are validated.
Documented 400/401/403/410/429 outcomes are rejected; transport failures,
non-contract status codes, 5xx and malformed successful receipts are uncertain.
Neither class is retried in the adapter. Error messages never include provider
bodies or private transport diagnostics. 61 focused connector tests and typecheck
pass; no message was sent to a real provider.

Before exposing replies, implement a tenant/model/connection/actor/counterpart
bound durable intent with immutable approved text and client intent key, a
committed dispatch fence, one-attempt delivery, confirmed receipt persistence,
and explicit uncertain reconciliation. A crashed dispatch cannot return to the
ready queue automatically. Recheck active shift/assignment and publishing halt
before dispatch. Record author/delivery evidence without falsely claiming delivery
from a local timeline row. Add SFW checks per L3.0 and make rejection/uncertainty
visible in the GUI. Attachment/paid replies remain separate from this text path.

## Durable reply identity and dispatch fence (M310, 2026-09-17)

Migration 0046 adds `inbox_reply_intent` with forced tenant RLS and composite
model/account/actor ownership. `(org, actor, intent_key)` is unique; identity,
counterpart, approved text and creation time cannot be changed after insertion.
Only pending rows may be inserted. A database trigger permits pending to
dispatching/cancelled and dispatching to sent/rejected/uncertain, with required
timestamps and a unique provider receipt for sent records. No terminal row can
be returned to pending or rewritten. Runtime has no DELETE privilege. Parent
account/actor deletion is restricted while reply history references them; a
deliberate retention/purge policy is required instead of silently erasing evidence.

122 schema/migration tests, DB build, API typecheck and 33 real PostgreSQL tests
pass after 47 migrations. Competing conditional dispatch updates produce one
winner; cross-org reads/updates and cross-model/account or actor references fail.
Unknown delivery cannot be retried by resetting state. Successful receipt remains
immutable. Initial static migration scan required the repository's conventional
`CREATE TABLE IF NOT EXISTS` spelling; corrected before the successful runs.
Fixture `axiom_workspace_test_9f6f8df97ae888ff` removed; no live migration applied.

This is storage groundwork only. Creation/dispatch APIs, validation/SFW policy,
pre-dispatch safety checks, durable audit, crash classification, manual evidence
reconciliation and user controls remain. Reconciliation must preserve the original
terminal attempt and attach evidence, not rewrite it or enqueue an automatic resend.

Completion requires all applicable steps and live evidence; neither additive role
names nor empty navigation alone satisfies F-24/F-26.
