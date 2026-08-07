// ─── Capability Resolution & Caching — Vitest Suite ───
// Covers: resolveCapabilities delegation, cacheCapability caching behavior,
// and clearCapabilityCache invalidation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
let registry;
let capabilities;
beforeEach(async () => {
    vi.resetModules();
    registry = await import('./registry.js');
    capabilities = await import('./capabilities.js');
});
function fakeConnector(platform, capOverride) {
    const cap = {
        publish: true,
        media: ['image'],
        maxMediaBytes: 1000,
        maxMediaCount: 1,
        caption: true,
        maxCaptionLength: 100,
        scheduling: 'internal',
        metrics: ['likes'],
        refreshMetrics: true,
        ...capOverride,
    };
    return {
        platform,
        displayName: platform,
        publishMode: 'api',
        auth: { accessToken: 'tok' },
        capability: () => cap,
        async validate(_input) {
            return { valid: true, errors: [], warnings: [], infos: [], tosVerdict: 'pass' };
        },
        async publish(_input) {
            return { remoteId: 'r', state: 'published' };
        },
        async fetchMetrics(remoteId) {
            return { postId: remoteId, platform, collectedAt: new Date().toISOString(), metrics: {} };
        },
        async revoke() { },
    };
}
describe('resolveCapabilities', () => {
    it('delegates to the registered connector capability()', () => {
        const c = fakeConnector('x', { maxCaptionLength: 999 });
        registry.register(c);
        expect(capabilities.resolveCapabilities('x').maxCaptionLength).toBe(999);
    });
    it('throws when no connector is registered', () => {
        expect(() => capabilities.resolveCapabilities('x')).toThrow("No connector registered for platform 'x'");
    });
});
describe('cacheCapability', () => {
    it('calls capability() once and serves subsequent calls from cache', () => {
        const c = fakeConnector('instagram');
        const capabilitySpy = vi.spyOn(c, 'capability');
        registry.register(c);
        const first = capabilities.cacheCapability('instagram');
        const second = capabilities.cacheCapability('instagram');
        expect(capabilitySpy).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
    });
    it('throws when no connector is registered', () => {
        expect(() => capabilities.cacheCapability('instagram')).toThrow("No connector registered for platform 'instagram'");
    });
});
describe('clearCapabilityCache', () => {
    it('invalidates cached capabilities so capability() is called again', () => {
        const c = fakeConnector('fanvue');
        const capabilitySpy = vi.spyOn(c, 'capability');
        registry.register(c);
        capabilities.cacheCapability('fanvue');
        capabilities.cacheCapability('fanvue');
        expect(capabilitySpy).toHaveBeenCalledTimes(1);
        capabilities.clearCapabilityCache();
        capabilities.cacheCapability('fanvue');
        expect(capabilitySpy).toHaveBeenCalledTimes(2);
    });
});
//# sourceMappingURL=capabilities.test.js.map