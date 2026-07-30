// ─── Discord Connector ───
// Uses Discord webhooks for link-sharing posts. Discord does not expose
// post-level metrics via webhooks, so fetchMetrics returns an empty set.
import { BaseConnector } from './base.js';
import { validatePublish } from './validation.js';
const DISCORD_API_BASE = 'https://discord.com/api';
export class DiscordConnector extends BaseConnector {
    constructor(auth) {
        super('discord', 'Discord', 'link_share', auth);
    }
    capability() {
        return {
            publish: true,
            media: ['image', 'video'],
            maxMediaBytes: 26_214_400, // 25 MB
            maxMediaCount: 10,
            caption: true,
            maxCaptionLength: 2_000,
            scheduling: 'internal',
            metrics: ['views', 'likes', 'comments', 'shares'],
            refreshMetrics: false,
        };
    }
    async validate(input) {
        return validatePublish(input, this.capability());
    }
    async publish(input) {
        return this.idempotentPublish(input, async () => {
            const webhookUrl = this.auth.extra?.webhookUrl;
            if (!webhookUrl) {
                throw new Error('Discord requires a webhook URL in auth.extra.webhookUrl');
            }
            const caption = input.caption || '';
            const mediaUrls = input.mediaUrls;
            const linkUrl = input.options?.linkUrl;
            // Build embed
            const embed = {
                title: caption.length > 256 ? caption.slice(0, 253) + '...' : caption,
                color: 0x5865f2, // Discord blurple
                timestamp: new Date().toISOString(),
                footer: { text: 'Posted via Axiom' },
            };
            // Set the description with the full caption if it was truncated in title
            if (caption.length > 256) {
                embed.description = caption;
            }
            // Set the link URL
            if (linkUrl) {
                embed.url = linkUrl;
                embed.description = caption;
                // If title was the truncated caption, re-set it to something meaningful
                if (caption.length > 256) {
                    embed.title = 'Shared via Axiom';
                }
            }
            // Attach the first media as thumbnail/image
            if (mediaUrls.length > 0) {
                const firstMedia = mediaUrls[0];
                const mediaType = this.detectMediaType(firstMedia);
                if (mediaType === 'video') {
                    embed.video = { url: firstMedia };
                    // Also include as image thumbnail if possible
                    embed.image = { url: firstMedia };
                }
                else {
                    embed.image = { url: firstMedia };
                }
            }
            const payload = {
                embeds: [embed],
            };
            // Send the webhook
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new Error(`Discord webhook failed: HTTP ${response.status} — ${body}`);
            }
            const result = (await response.json());
            this.log('info', 'publish', `Discord webhook sent`, {
                messageId: result.id,
                channelId: result.channel_id,
                guildId: result.guild_id,
            });
            return {
                remoteId: result.id,
                state: 'published',
                postUrl: linkUrl,
            };
        });
    }
    async fetchMetrics(_remoteId, _period) {
        // Discord webhooks do not expose post-level metrics (views, likes, comments, shares).
        // This connector uses link_share mode where analytics are handled externally.
        this.log('info', 'fetchMetrics', 'Discord does not expose post metrics via webhooks; returning empty');
        return {
            postId: _remoteId,
            platform: this.platform,
            collectedAt: new Date().toISOString(),
            metrics: {
                views: 0,
                likes: 0,
                comments: 0,
                shares: 0,
            },
        };
    }
    async revoke() {
        const webhookUrl = this.auth.extra?.webhookUrl;
        if (!webhookUrl) {
            this.log('warn', 'revoke', 'No webhook URL set; skipping revoke');
            return;
        }
        // Parse webhook ID from URL: /api/webhooks/{webhookId}/{webhookToken}
        const match = webhookUrl.match(/\/webhooks\/(\d+)\//);
        if (!match) {
            this.log('warn', 'revoke', 'Could not parse webhook ID from URL; skipping');
            return;
        }
        const webhookId = match[1];
        // Delete the webhook via Discord API
        const response = await fetch(`${DISCORD_API_BASE}/webhooks/${webhookId}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            this.log('warn', 'revoke', `Discord webhook deletion warned: HTTP ${response.status} — ${body}`);
        }
        else {
            this.log('info', 'revoke', `Discord webhook ${webhookId} deleted successfully`);
        }
        // Clear cached auth data
        this.auth.accessToken = '';
        this.auth.refreshToken = undefined;
        this.auth.expiresAt = 0;
    }
    /** Detect media type from URL extension */
    detectMediaType(url) {
        try {
            const pathname = new URL(url).pathname;
            const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
            const videoExts = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v']);
            return videoExts.has(ext) ? 'video' : 'image';
        }
        catch {
            return 'image';
        }
    }
}
export default DiscordConnector;
//# sourceMappingURL=discord.js.map