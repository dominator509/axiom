# Public application brand

The default product name is **FanThynks**. The existing Shared Roof mark,
colors, typeface and icons remain unchanged. Technical identifiers (`@axiom/*`,
`AXIOM_*`, protocol headers, database/repository names and historical receipts)
remain compatible.

Set `AXIOM_BRAND_NAME` and optionally `AXIOM_BRAND_TAGLINE` on the API process,
then restart that process. No dashboard rebuild is required. These two values
are intentionally public: never put credentials or private information in them.
Names allow 1–80 Unicode code points; taglines allow 1–160. Values are trimmed;
control characters and multiline values are invalid. Missing/invalid names use
FanThynks; missing/invalid taglines preserve each locale's existing default.
Fields fall back independently. Startup diagnostics identify invalid field names
only. One configured tagline is used in all six supported languages.

`GET /api/v1/brand` is anonymous, read-only and `Cache-Control: no-store`:

```json
{"data":{"name":"FanThynks","tagline":null}}
```

The dashboard fetches this projection server-side with a two-second timeout,
request-local reuse and safe fallback on unavailable/malformed responses. Text
is rendered through React; custom markup and interpolation braces remain text.
Only the two public fields cross the server/client boundary.

## Isolated browser acceptance

From a clean committed checkout, with Node 22.23.3 and local Docker running:

```sh
pnpm install --frozen-lockfile
pnpm test:browser
```

This builds real API/dashboard images and a pinned Chromium runner, then runs
the journey twice with fresh databases. Each run checks default branding and
an API-only restart with configured branding. The first run also verifies that
deliberately wrong expected branding and stripped authentication cookies make
the intended assertions fail, before an uninjected passing journey.

The test owns an internal Docker network, labeled disposable database volume,
fresh credentials and ephemeral HTTPS certificate. No host ports, bind mounts,
existing database, external provider or owner service is used. The runner alone
ignores its generated certificate; production Secure/HttpOnly cookie settings
remain intact. Signup uses the real API; tenant assignment is explicit fixture
SQL against the owned test database. Cleanup verifies ownership labels and
checks that containers, networks and database volumes are gone, including after
failure. Browser contexts, certificates and profiles stay inside the runner.

Source SHA, image IDs, exact commands, assertion counts, expected negative
failures and cleanup results are recorded under `var/browser-rehearsal/`.
Sanitized logs omit generated secrets and browser credential/cookie dumps.
The independent `browser` CI job prints the receipt and journey logs. Existing
HTTP/container smoke remains a separate gate. See
[the approved acceptance contract](../L3-specification/L3.7-public-brand-and-browser-acceptance.md).

The browser journey exposed a shared rate-bucket collision: the first request
from an IP selected the capacity/refill for subsequent requests under different
route policies. Buckets now share only within identical configured policies,
with the existing per-policy LRU limits. Auth remains 20 requests/1 per second;
the general API remains 60 requests/10 per second. Regression tests cover both
request orders, different refill rates and sharing within the same policy.
