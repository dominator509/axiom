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
