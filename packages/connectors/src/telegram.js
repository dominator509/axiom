// ─── Telegram Connector (link_share) ───
// Uses a Telegram bot to post content links with previews
import { BaseConnector } from './base.js';
const TG_API_BASE = 'https://api.telegram.org/bot';
export class TelegramConnector extends BaseConnector {
    botToken;
    constructor(auth) {
        super('telegram', 'Telegram', 'link_share', auth);
        this.botToken = auth.accessToken;
    }
    get apiBase() {
        return `${TG_API_BASE}${this.botToken}`;
    }
    capability() {
        return {
            publish: true,
            media: ['image', 'video'],
            maxMediaBytes: 50_000_000, // 50 MB
            maxMediaCount: 1,
            caption: true,
            maxCaptionLength: 1024,
            scheduling: 'internal',
            metrics: [],
            refreshMetrics: false,
        };
    }
    async validate(input) {
        const errors = [];
        if (!input.mediaUrls || input.mediaUrls.length === 0) {
            errors.push({ field: 'mediaUrls', message: 'At least one media URL required for link share', severity: 'error' });
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings: [],
            infos: [],
            tosVerdict: 'pass',
        };
    }
    async publish(input) {
        return this.idempotentPublish(input, async () => {
            const channelId = this.auth.externalUserId || '@channel';
            const linkUrl = input.mediaUrls[0];
            const caption = input.caption || '';
            // Post content link with preview to Telegram channel
            const text = `${caption}\n\n${linkUrl}`;
            const hashtags = input.hashtags?.length ? `\n\n${input.hashtags.map((h) => `#${h}`).join(' ')}` : '';
            const response = await this.apiPost(`${this.apiBase}/sendMessage`, {
                chat_id: channelId,
                text: text + hashtags,
                parse_mode: 'HTML',
                disable_web_page_preview: false,
            });
            this.log('info', 'publish', `Telegram link shared to ${channelId}: msg ${response.result.message_id}`);
            return {
                remoteId: String(response.result.message_id),
                state: 'published',
                postUrl: `https://t.me/${channelId.replace('@', '')}/${response.result.message_id}`,
            };
        });
    }
    async fetchMetrics(_remoteId, _period) {
        // Telegram Bot API does not expose per-message analytics
        return {
            postId: _remoteId,
            platform: 'telegram',
            collectedAt: new Date().toISOString(),
            metrics: {},
        };
    }
    async revoke() {
        // Revoke bot token via Telegram API
        await this.apiPost(`${this.apiBase}/logOut`, {});
        this.log('info', 'revoke', 'Telegram bot logged out');
    }
}
//# sourceMappingURL=telegram.js.map