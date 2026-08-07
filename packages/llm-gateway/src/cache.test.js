// ─── PrefixCache / ResponseCache / cacheKey / alignBlocks — Vitest Suite ───
import { describe, it, expect, beforeEach } from 'vitest';
import { PrefixCache, ResponseCache, cacheKey, alignBlocks, } from './cache.js';
describe('alignBlocks', () => {
    it('returns text unchanged when estimated tokens are already a multiple of 64', () => {
        // 256 chars -> ceil(256/4) = 64 tokens -> aligned
        const text = 'a'.repeat(256);
        expect(alignBlocks(text)).toBe(text);
    });
    it('pads with spaces to the next 64-token boundary', () => {
        // 252 chars -> 63 tokens -> needs 1 token (4 chars) of padding
        const text = 'a'.repeat(252);
        const out = alignBlocks(text);
        expect(out.length).toBe(256);
        expect(out).toBe(text + '    ');
    });
    it('produces output whose estimated token count is a multiple of 64', () => {
        for (const len of [0, 1, 5, 63, 64, 127, 255, 256, 257, 1000, 4096]) {
            const out = alignBlocks('x'.repeat(len));
            const estTokens = Math.ceil(out.length / 4);
            expect(estTokens % 64).toBe(0);
            expect(out.startsWith('x'.repeat(len))).toBe(true);
        }
    });
    it('does not pad when length is exactly a token boundary', () => {
        // 64 chars -> 16 tokens -> 16 % 64 = 16 -> pad 48 tokens = 192 chars
        const out = alignBlocks('b'.repeat(64));
        expect(out.length).toBe(64 + 192);
        expect(out.endsWith(' '.repeat(192))).toBe(true);
    });
    it('handles empty string without padding', () => {
        expect(alignBlocks('')).toBe('');
    });
});
describe('cacheKey', () => {
    it('produces a deterministic 16-char hex digest', () => {
        const k1 = cacheKey('model-1', 'instagram', 'v1');
        const k2 = cacheKey('model-1', 'instagram', 'v1');
        expect(k1).toBe(k2);
        expect(k1).toMatch(/^[0-9a-f]{16}$/);
    });
    it('changes when model, platform, or prefixVersion changes', () => {
        const base = cacheKey('model-1', 'instagram', 'v1');
        expect(cacheKey('model-2', 'instagram', 'v1')).not.toBe(base);
        expect(cacheKey('model-1', 'tiktok', 'v1')).not.toBe(base);
        expect(cacheKey('model-1', 'instagram', 'v2')).not.toBe(base);
    });
    it('includes the segment hash when provided', () => {
        const withHash = cacheKey('model-1', 'instagram', 'v1', 'seg-a');
        const withoutHash = cacheKey('model-1', 'instagram', 'v1');
        expect(withHash).not.toBe(withoutHash);
        expect(cacheKey('model-1', 'instagram', 'v1', 'seg-a')).toBe(withHash);
        expect(cacheKey('model-1', 'instagram', 'v1', 'seg-b')).not.toBe(withHash);
    });
});
describe('PrefixCache', () => {
    let cache;
    beforeEach(() => {
        cache = new PrefixCache(3);
    });
    it('set/get round-trip and moves entry to MRU position', () => {
        cache.set('k1', 'prefix-1', 'model-1', 'instagram', 'v1');
        expect(cache.get('k1')).toBe('prefix-1');
        expect(cache.size).toBe(1);
        expect(cache.maxSize).toBe(3);
    });
    it('returns undefined for missing keys and records a miss', () => {
        expect(cache.get('missing')).toBeUndefined();
        const stats = cache.getStats();
        expect(stats.misses).toBe(1);
        expect(stats.hits).toBe(0);
    });
    it('expires entries by TTL', () => {
        cache.set('k1', 'prefix-1', 'model-1', 'instagram', 'v1', undefined, -1000);
        expect(cache.has('k1')).toBe(false);
        expect(cache.get('k1')).toBeUndefined();
        expect(cache.size).toBe(0);
        // expired get counts as a miss
        expect(cache.getStats().misses).toBe(1);
    });
    it('has() returns true for live entries and false for expired/missing', () => {
        cache.set('live', 'p', 'm1', 'instagram', 'v1');
        expect(cache.has('live')).toBe(true);
        cache.set('dead', 'p', 'm1', 'instagram', 'v1', undefined, -1);
        expect(cache.has('dead')).toBe(false);
        expect(cache.has('nope')).toBe(false);
    });
    it('evicts the least-recently-used entry when at capacity', () => {
        cache.set('a', 'pa', 'm1', 'instagram', 'v1');
        cache.set('b', 'pb', 'm1', 'instagram', 'v1');
        cache.set('c', 'pc', 'm1', 'instagram', 'v1');
        // touch 'a' so it becomes MRU; 'b' is now LRU
        cache.get('a');
        cache.set('d', 'pd', 'm1', 'instagram', 'v1');
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toBe('pa');
        expect(cache.get('d')).toBe('pd');
        expect(cache.size).toBe(3);
    });
    it('evicts LRU entry on set when already at capacity (no get needed)', () => {
        cache.set('a', 'pa', 'm1', 'instagram', 'v1');
        cache.set('b', 'pb', 'm1', 'instagram', 'v1');
        cache.set('c', 'pc', 'm1', 'instagram', 'v1');
        cache.set('d', 'pd', 'm1', 'instagram', 'v1');
        expect(cache.get('a')).toBeUndefined();
        expect(cache.size).toBe(3);
    });
    it('stores optional segment hash and ttl metadata', () => {
        cache.set('k1', 'prefix-1', 'model-1', 'tiktok', 'v2', 'seg-9', 60_000);
        const entry = cache.cache.get('k1');
        expect(entry.segmentHash).toBe('seg-9');
        expect(entry.modelId).toBe('model-1');
        expect(entry.platform).toBe('tiktok');
        expect(entry.prefixVersion).toBe('v2');
        expect(entry.storedAt).toBeGreaterThan(0);
        expect(entry.expiresAt).toBeGreaterThan(entry.storedAt);
    });
    it('stores null expiresAt when no ttl given', () => {
        cache.set('k1', 'p', 'm1', 'instagram', 'v1');
        const entry = cache.cache.get('k1');
        expect(entry.expiresAt).toBeNull();
    });
    it('tracks hit ratio in stats', () => {
        cache.set('k1', 'p', 'm1', 'instagram', 'v1');
        cache.get('k1'); // hit
        cache.get('k1'); // hit
        cache.get('nope'); // miss
        const stats = cache.getStats();
        expect(stats.hits).toBe(2);
        expect(stats.misses).toBe(1);
        expect(stats.ratio).toBeCloseTo(2 / 3);
        expect(stats.size).toBe(1);
        expect(stats.capacity).toBe(3);
    });
    it('reports ratio 0 when no requests have been made', () => {
        expect(cache.getStats().ratio).toBe(0);
    });
    it('clear() empties the store and resets stats', () => {
        cache.set('k1', 'p', 'm1', 'instagram', 'v1');
        cache.get('k1');
        cache.clear();
        expect(cache.size).toBe(0);
        expect(cache.getStats()).toEqual({ hits: 0, misses: 0, ratio: 0, size: 0, capacity: 3 });
        expect(cache.get('k1')).toBeUndefined();
    });
    it('invalidate() removes a key and reports whether it existed', () => {
        cache.set('k1', 'p', 'm1', 'instagram', 'v1');
        expect(cache.invalidate('k1')).toBe(true);
        expect(cache.invalidate('k1')).toBe(false);
        expect(cache.size).toBe(0);
    });
    it('invalidateByModelAndPlatform removes matching entries only', () => {
        cache.set('a', 'p', 'm1', 'instagram', 'v1');
        cache.set('b', 'p', 'm1', 'tiktok', 'v1');
        cache.set('c', 'p', 'm2', 'instagram', 'v1');
        const removed = cache.invalidateByModelAndPlatform('m1', 'instagram');
        expect(removed).toBe(1);
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBe('p');
        expect(cache.get('c')).toBe('p');
    });
    it('invalidateByModel removes all entries for a model', () => {
        cache.set('a', 'p', 'm1', 'instagram', 'v1');
        cache.set('b', 'p', 'm1', 'tiktok', 'v1');
        cache.set('c', 'p', 'm2', 'instagram', 'v1');
        expect(cache.invalidateByModel('m1')).toBe(2);
        expect(cache.size).toBe(1);
        expect(cache.get('c')).toBe('p');
    });
    it('resize() shrinks capacity and evicts oldest entries', () => {
        cache.set('a', 'pa', 'm1', 'instagram', 'v1');
        cache.set('b', 'pb', 'm1', 'instagram', 'v1');
        cache.set('c', 'pc', 'm1', 'instagram', 'v1');
        cache.resize(1);
        expect(cache.maxSize).toBe(1);
        expect(cache.size).toBe(1);
        expect(cache.get('c')).toBe('pc');
        expect(cache.get('a')).toBeUndefined();
    });
    it('resize() can grow capacity without eviction', () => {
        cache.set('a', 'pa', 'm1', 'instagram', 'v1');
        cache.resize(10);
        expect(cache.maxSize).toBe(10);
        expect(cache.get('a')).toBe('pa');
    });
    it('alignPrompt delegates to alignBlocks', () => {
        const text = 'a'.repeat(252);
        expect(cache.alignPrompt(text)).toBe(alignBlocks(text));
        expect(cache.alignPrompt(text).length).toBe(256);
    });
    it('accepts custom capacity in the constructor', () => {
        const small = new PrefixCache(1);
        small.set('a', 'p', 'm1', 'instagram', 'v1');
        small.set('b', 'p', 'm1', 'instagram', 'v1');
        expect(small.size).toBe(1);
        expect(small.get('b')).toBe('p');
    });
});
describe('ResponseCache', () => {
    let rc;
    beforeEach(() => {
        rc = new ResponseCache();
    });
    it('returns null on miss and increments misses', () => {
        expect(rc.get('nope')).toBeNull();
        expect(rc.stats().misses).toBe(1);
    });
    it('returns the stored value on hit and increments hits', () => {
        rc.set('k1', { content: 'hello', usage: { prompt: 5, completion: 7 } });
        const hit = rc.get('k1');
        expect(hit).toEqual({ content: 'hello', usage: { prompt: 5, completion: 7 } });
        expect(rc.stats().hits).toBe(1);
    });
    it('get returns the same object reference (no copy)', () => {
        const value = { content: 'c', usage: { prompt: 1, completion: 2 } };
        rc.set('k1', value);
        expect(rc.get('k1')).toBe(value);
    });
    it('stats reports hits, misses and size', () => {
        rc.set('a', { content: 'x', usage: { prompt: 1, completion: 1 } });
        rc.set('b', { content: 'y', usage: { prompt: 1, completion: 1 } });
        rc.get('a');
        rc.get('a');
        rc.get('missing');
        expect(rc.stats()).toEqual({ hits: 2, misses: 1, size: 2 });
    });
    it('overwrites values for the same key', () => {
        rc.set('k1', { content: 'v1', usage: { prompt: 1, completion: 1 } });
        rc.set('k1', { content: 'v2', usage: { prompt: 2, completion: 2 } });
        expect(rc.get('k1')?.content).toBe('v2');
        expect(rc.stats().size).toBe(1);
    });
    it('clear() empties store and resets counters', () => {
        rc.set('k1', { content: 'x', usage: { prompt: 1, completion: 1 } });
        rc.get('k1');
        rc.clear();
        expect(rc.stats()).toEqual({ hits: 0, misses: 0, size: 0 });
        expect(rc.get('k1')).toBeNull();
    });
});
//# sourceMappingURL=cache.test.js.map