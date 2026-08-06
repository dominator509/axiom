import { describe, it, expect } from 'vitest';
import { publishIdemKey, minuteSlot, jobDedupeKey } from './idempotency.js';
describe('minuteSlot', () => {
    it('buckets to the minute', () => {
        expect(minuteSlot(new Date('2026-08-06T10:15:59Z'))).toBe('2026-08-06T10:15');
        expect(minuteSlot(new Date('2026-08-06T10:16:00Z'))).toBe('2026-08-06T10:16');
    });
});
describe('publishIdemKey', () => {
    it('is deterministic for the same inputs', () => {
        const input = { modelId: 'm1', assetSha256: 'abc', platform: 'instagram', when: new Date('2026-08-06T10:15:00Z') };
        expect(publishIdemKey(input)).toBe(publishIdemKey(input));
    });
    it('changes when platform or slot changes', () => {
        const base = { modelId: 'm1', assetSha256: 'abc', platform: 'instagram', when: new Date('2026-08-06T10:15:00Z') };
        expect(publishIdemKey(base)).not.toBe(publishIdemKey({ ...base, platform: 'tiktok' }));
        expect(publishIdemKey(base)).not.toBe(publishIdemKey({ ...base, when: new Date('2026-08-06T10:16:00Z') }));
    });
    it('falls back to no-asset when asset hash missing', () => {
        const a = publishIdemKey({ modelId: 'm1', platform: 'x' });
        const b = publishIdemKey({ modelId: 'm1', platform: 'x' });
        expect(a).toBe(b);
    });
});
describe('jobDedupeKey', () => {
    it('returns a stable 32-byte buffer', () => {
        const a = jobDedupeKey(['bundle-1', 'instagram']);
        const b = jobDedupeKey(['bundle-1', 'instagram']);
        expect(a.equals(b)).toBe(true);
        expect(a.length).toBe(32);
        expect(jobDedupeKey(['bundle-1', 'tiktok']).equals(a)).toBe(false);
    });
});
//# sourceMappingURL=idempotency.test.js.map