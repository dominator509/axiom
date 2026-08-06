// ─── Idempotency keys (L3.4 §4 / LBI-05) ───
// Publish key: SHA256(model_id ‖ asset_sha256 ‖ platform ‖ slot)
// slot is the scheduled minute bucket (or "now"). Guarantees retries and
// double-taps can never produce a duplicate post.
import { createHash } from 'node:crypto';
/** Bucket a timestamp to its minute slot. */
export function minuteSlot(when = new Date()) {
    return when.toISOString().slice(0, 16);
}
/** Derive the canonical publish idempotency key (hex sha256). */
export function publishIdemKey(input) {
    const asset = input.assetSha256 ?? 'no-asset';
    const slot = input.when ? minuteSlot(input.when) : minuteSlot();
    return createHash('sha256')
        .update([input.modelId, asset, input.platform, slot].join('\u0000'))
        .digest('hex');
}
/** Job dedupe key for enqueue (hex sha256 of the unit-of-work). */
export function jobDedupeKey(parts) {
    return createHash('sha256').update(parts.join('\u0000')).digest();
}
//# sourceMappingURL=idempotency.js.map