# Venice cache pilot and contract gaps

At `bd76cbe1e112f51c9f8a5cc76e28b34fabeaa126`, all twelve post-merge CI jobs
passed and hosted receipts were verified. A bounded live pilot then made four
sequential TOKENKILLER requests using existing Venice credit, two synthetic
profiles, and two tasks per profile. No local response-cache hit or retry
occurred; raw provider counters, gateway results, and one observer per request
matched. No database, publishing destination, or production service was used.

| Cohort | Responses with counters | Cached / prompt tokens | Weighted cache hit rate |
| --- | ---: | ---: | ---: |
| First-use | 2/2 | 16 / 3,036 | 0.5270% |
| Repeat-prefix | 2/2 | 352 / 3,038 | 11.5866% |

The repeat cohort missed the required **greater than 97%** threshold. Its
emitted static prefixes were byte-identical within each pair (1,286 bytes).
Latencies were 1,418 / 1,211 / 1,395 / 1,371 ms; provider billing totaled
USD 0.0013075 and DIEM 0, with no missing billing observations. Four HTTP
successes over 6,750 ms do not establish publishing-path availability or the
full 1–20-model workload. First-use is not a claim of globally cold provider
cache state. No release acceptance row is promoted by these observations.

The private dispatch receipt SHA-256 is
`a34336b080e75512c26dd820e02730cbb23b781eb6dfdb618aedee66083d9b4e`.
Its source, helper, and compiled-module hashes, synthetic inputs, dispatch
journals, and sanitized observations remain under ignored
`var/live-venice-cache-cohort/`. The completed journal must not be reused.

## Contract review

Venice's [cache guide](https://docs.venice.ai/guides/features/prompt-caching)
and [chat endpoint](https://docs.venice.ai/api-reference/endpoint/chat/completions),
reviewed on 2026-10-25, document `prompt_cache_key` as an optional routing hint
and `usage.prompt_tokens_details.cache_creation_input_tokens` as cache-write
telemetry. Neither guarantees a cache hit or a particular discount for every
model. Pricing must come from the selected model and actual billing.

Two source gaps identified after the pilot are addressed by this change:

1. The mapper now reads the documented cache-write field, preserving the legacy
   alias and rejecting conflicting values. The pilot captured only the legacy
   field, so it cannot establish whether canonical cache-write telemetry was
   absent from the actual responses.
2. Venice participates in the existing persisted controls. Migration 0082
   extends only the provider constraint; defaults remain disabled. API and
   worker loaders hash the bounded label together with tenant/model identity
   before emitting the routing hint in chat or streaming requests. Raw labels
   and tenant IDs are not sent as the hint. Changing or disabling the setting
   also changes the gateway response-cache identity. The dashboard uses the
   existing localized controls. A routing key does not replace tenant access
   controls or guarantee provider cache isolation.

Regressions cover counter validity, routing bodies, tenant/model key separation,
disabled controls, API persistence projection, worker loading and six dashboard
locales. The migrated PostgreSQL rehearsal checks enabled/disabled persistence,
cross-tenant CRUD, reassignment, model ownership, missing context and bounds.
These checks use synthetic data; they do not establish live cache efficiency.

These gaps do not prove the reason for the pilot's low hit rate. Provider
routing/placement/eviction remains unobserved. Further inference should use a
separately reviewed bounded comparison after the relevant change is merged
and post-merge CI passes; preserve all observations and avoid repeated runs
until a desired percentage appears or artificial prompt padding.
