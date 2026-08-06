export interface PublishKeyInput {
    modelId: string;
    assetSha256?: string | null;
    platform: string;
    /** ISO timestamp to bucket; default now. */
    when?: Date;
}
/** Bucket a timestamp to its minute slot. */
export declare function minuteSlot(when?: Date): string;
/** Derive the canonical publish idempotency key (hex sha256). */
export declare function publishIdemKey(input: PublishKeyInput): string;
/** Job dedupe key for enqueue (hex sha256 of the unit-of-work). */
export declare function jobDedupeKey(parts: Array<string | number>): Buffer;
//# sourceMappingURL=idempotency.d.ts.map