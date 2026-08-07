// ─── Connectors Barrel Export — Vitest Suite ───
// Verifies every symbol exported from packages/connectors/src/index.ts resolves.
import { describe, it, expect } from 'vitest';
import * as connectors from './index.js';
describe('@axiom/connectors barrel exports', () => {
    it('exports the BaseConnector class', () => {
        expect(connectors.BaseConnector).toBeTypeOf('function');
    });
    it('exports every platform connector class', () => {
        const classes = [
            'InstagramConnector',
            'TikTokConnector',
            'YouTubeConnector',
            'XConnector',
            'FacebookConnector',
            'RedditConnector',
            'ThreadsConnector',
            'DiscordConnector',
            'TelegramConnector',
            'SnapchatConnector',
            'FanvueConnector',
        ];
        for (const name of classes) {
            expect(connectors[name]).toBeTypeOf('function');
        }
    });
    it('exports all registry functions', () => {
        const fns = [
            'register',
            'connectorFor',
            'hasConnector',
            'allConnectors',
            'registeredPlatforms',
            'resolveCapabilities',
            'validateForPlatform',
        ];
        for (const name of fns) {
            expect(connectors[name]).toBeTypeOf('function');
        }
    });
    it('exports validatePublish', () => {
        expect(connectors.validatePublish).toBeTypeOf('function');
    });
    it('does not export internal helpers unintentionally', () => {
        // capabilities.ts is intentionally NOT re-exported from the barrel.
        expect('clearCapabilityCache' in connectors).toBe(false);
    });
});
//# sourceMappingURL=index.test.js.map