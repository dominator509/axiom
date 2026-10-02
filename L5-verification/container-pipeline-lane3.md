# Lane 3: container pipeline acceptance

Source baseline after lanes 1 and 2:
`02bbb0da2d2282e861764ff2788f42fbfaf9bbfd`.
[Baseline CI run](https://github.com/dominator509/axiom/actions/runs/37020313710)
and [container job/log](https://github.com/dominator509/axiom/actions/runs/37020313710/job/110881414616).
Consult the completed job result; a link alone does not assert success.
The lane PR supplies the final candidate SHA, fresh run URL, and observed counts.

## Exact build commands

Run these from the repository root in an isolated environment, as in
`.github/workflows/ci.yml`. They build seven images:

```sh
docker build --file infra/Dockerfile.hono --tag axiom-hono:ci .
docker build --build-arg API_ORIGIN=http://127.0.0.1:3001 --file infra/Dockerfile.next --tag axiom-dashboard:ci .
docker build --file infra/Dockerfile.worker --tag axiom-worker:ci .
docker build --file infra/Dockerfile.rust --tag axiom-egress-plane:ci .
docker build --file infra/Dockerfile.media --tag axiom-media-plane:ci .
docker build --file infra/Dockerfile.vision --tag axiom-vision-engine:ci .
docker build --file infra/Dockerfile.scraper --tag axiom-scraper:ci .
```

Base images use immutable digests. JavaScript dependency installs use the frozen
lockfile. The dashboard build embeds the explicit loopback API fixture.
No deployment origins are changed by this lane.

## Runtime acceptance and boundaries

The CI container step creates disposable service containers and an isolated
PostgreSQL test database. It uses the non-owner application role for the API.
Its exit trap removes the seven service containers; the Actions service teardown
removes the disposable PostgreSQL container. Never run its database preparation
against a production/shared database, or copy CI fixture credentials outside CI.

Six service health checks must pass: egress, media, scraper, Hono API,
dashboard, and worker. Worker health alone proves process liveness; the smoke
test separately requires actual persisted worker progress.

The exact HTTP smoke command is:

```sh
node scripts/smoke-auth.mjs http://127.0.0.1:3000 https://127.0.0.1:3001 --tenant-fixture --wait-for-tos
```

This exercises the real dashboard rewrite into the API on port 3001.
The second URL supplies the configured auth Origin header over loopback; this
is not a browser TLS or browser-cookie acceptance test.

The smoke script emits 14 completion groups, not a unit-test case count:

1. Character lock: concurrent winner, durable readback, idempotent replay.
2. Upload: packaged sanitizer, deduplication, source listing, tenant boundary.
3. Preview: authenticated bytes, stored hash, removed private trailer.
4. Generation pause: missing safety settings fail closed.
5. Worker: completed ToS job and one persisted Relay card job.
6. Decision: rejection replay/conflict, one audit, no publish targets.
7. Relay lifecycle: obsolete card retired without external delivery.
8. Approval: consent denial, replay, exactly one future target/job.
9. Generation: five prompt/caption variants and one durable scan job.
10. Native linkbio: create, replay, anonymous view/redirect, disable/re-enable.
11. Safety status: operator denial; owner read creates no settings.
12. Network metadata: owner-only save/read/clear; no egress claim asserted.
13. Tenant: idempotency, cross-tenant read/write denial, pagination/rendering.
14. Auth: login, signup privilege rejection, HttpOnly session restoration and
    revocation; anonymous/unassigned identities denied.

Further container-step assertions:

- Vision: public health response contains model-status metadata; an
  unauthenticated inference-route request returns HTTP 401. The CI image omits
  the external model artifact. No model readiness, authenticated inference,
  model accuracy, or model-backed ToS classification is claimed.
- Egress: an authenticated control-plane status request succeeds.
- Media: unauthenticated probe returns HTTP 401; authenticated probe succeeds.
- API readiness: `curl --fail --silent --show-error http://127.0.0.1:3001/api/v1/ready`
  succeeds after real database dependency checks.

These assertions are unchanged in Lane 3. Only the misleading vision success
label is corrected to describe the actual health/auth-denial checks.
Failures remain fatal; no skip, retry relaxation, or continue-on-error is added.

## Evidence limits

Local inspection command `docker info --format '{{.ServerVersion}}'` exited 1:
the Docker Desktop Linux daemon pipe was absent. No local image build or smoke
execution is claimed; do not start an owner's existing service to manufacture
an isolated-runtime receipt. Use the fresh hosted job for this lane's execution
evidence.

Successful CI demonstrates packaged isolated behavior, not deployed operations,
live-provider delivery/publication, model inference, recovery acceptance, or
production readiness for the remaining lanes.
