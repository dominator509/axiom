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
