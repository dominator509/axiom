# Model-scoped human roles — implementation queue

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

Completion requires all applicable steps and live evidence; neither additive role
names nor empty navigation alone satisfies F-24/F-26.
