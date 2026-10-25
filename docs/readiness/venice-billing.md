# Venice billing evidence

Venice responses can report a top-level `cost` object with independent `usd`
and `diem` amounts. The gateway preserves these as `providerBilling`; its
legacy `cost` field contains only the reported USD component. Missing,
negative, nonnumeric, or nonfinite amounts become `null`, not zero. A zero USD
charge does not establish free inference: DIEM may have been charged or may
be unreported. Other providers retain their existing cost semantics.

Streaming requests ask for `stream_options.include_usage`. Both Venice paths
consume bounded SSE through `[DONE]` or EOF, including usage/cost events after
`finish_reason` and an unterminated final line. Repeated cost envelopes replace
the previous observation; they are not summed. Interrupted or cancelled streams
do not emit a completed billing observation. This does not establish that an
interrupted provider request was unbilled.

`ChatOptions.providerBillingObserver` receives one sanitized currency observation
for each completed Venice request, including unknown amounts. Local response
cache hits have zero incremental cost and do not replay the previous provider
bill. Observer rejection is isolated from inference retries and its potentially
sensitive error message is not logged. Callers collecting release evidence must
verify their own persistence: successful inference does not prove an observer
saved its receipt. No default billing persistence or new database schema is
introduced.

Contract source: [Venice chat completions API](https://docs.venice.ai/api-reference/endpoint/chat/completions).
The regression suite uses synthetic responses only. It establishes parsing and
observer behavior, not actual account charges, provider cache efficiency, model
capacity, or the release cost gate. Real measurements must retain separate
currencies and explicitly report unknown costs.

## Cache counter propagation

Venice chat and streaming responses also preserve explicit
`usage.prompt_tokens_details.cached_tokens` and `created_cache_tokens` through
the shared cache normalizer. Counters must be nonnegative safe integers and
consistent with the reported prompt-token total. Missing or invalid telemetry
remains unknown; an explicit zero hit count remains a measured zero. Streaming
uses the last usage snapshot, including snapshots after `finish_reason`, rather
than summing cumulative counters or retaining stale valid counters after an
invalid final snapshot.

The existing `providerCacheObserver` receives one observation per completed
provider request. API and worker observers use the existing tenant-scoped
database persistence; no schema change is required. Local response-cache hits
do not replay provider observations, and observer failures do not retry
inference. Interrupted streams do not produce completed cache observations.

A bounded live probe at `c3aedb9d646fa60ecdf26ecea6804ee9910b50e0`
reported 1,761 prompt tokens and 1,728 cached tokens while the gateway discarded
the cache usage. Its sanitized counters are regression inputs for this fix.
That single request does not establish controlled cold/warm performance,
TOKENKILLER efficiency, or the greater-than-97-percent release criterion.
Those criteria require a separately recorded provider-backed workload, with
unknown observations retained in its accounting.
