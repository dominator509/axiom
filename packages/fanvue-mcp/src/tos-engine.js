import { VisionEngineClient } from './vision.js';
// ─── Platform Thresholds ───
/**
 * Default ToS violation score thresholds per platform (0–100 scale).
 * Higher values = more permissive; lower values = more restrictive.
 * These represent the maximum acceptable ToS violation probability (%).
 */
export const DEFAULT_PLATFORM_THRESHOLDS = {
    instagram: 70,
    tiktok: 65,
    x: 75,
    youtube: 60,
    facebook: 70,
    reddit: 65,
    threads: 70,
    snapchat: 60,
    discord: 70,
    telegram: 70,
    fanvue: 80,
};
export const PLATFORM_RULES = {
    instagram: {
        platform: 'instagram',
        description: 'Instagram Community Guidelines — no nudity, hate speech, harassment',
        blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans'],
        maxHashtags: 30,
        maxCaptionLength: 2200,
        linksAllowed: true,
        reviewCategories: ['suggestive', 'revealing', 'sexual_wellness'],
    },
    tiktok: {
        platform: 'tiktok',
        description: 'TikTok Community Guidelines — no sexually explicit content, adult nudity',
        blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans', 'nsfw'],
        maxHashtags: 20,
        maxCaptionLength: 2200,
        linksAllowed: false,
        reviewCategories: ['suggestive', 'revealing', 'intimate'],
    },
    x: {
        platform: 'x',
        description: 'X/Twitter Rules — no violent content, harassment, adult content (permissive)',
        blockedKeywords: ['violence', 'gore', 'harassment'],
        maxHashtags: 50,
        maxCaptionLength: 4000,
        linksAllowed: true,
        reviewCategories: ['suggestive'],
    },
    youtube: {
        platform: 'youtube',
        description: 'YouTube Community Guidelines — no nudity, sexual content, harmful content',
        blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans', 'nsfw', 'violence', 'gore'],
        maxHashtags: 15,
        maxCaptionLength: 5000,
        linksAllowed: true,
        reviewCategories: ['suggestive', 'revealing', 'sexual_wellness', 'intimate'],
    },
    facebook: {
        platform: 'facebook',
        description: 'Facebook Community Standards — no nudity, sexual solicitation, hate speech',
        blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans', 'nsfw'],
        maxHashtags: 30,
        maxCaptionLength: 63206,
        linksAllowed: true,
        reviewCategories: ['suggestive', 'revealing', 'sexual_wellness'],
    },
    reddit: {
        platform: 'reddit',
        description: 'Reddit Content Policy — no harassment, no involuntary pornography',
        blockedKeywords: ['harassment', 'dox', 'gore'],
        maxHashtags: 0,
        maxCaptionLength: 40000,
        linksAllowed: true,
        reviewCategories: ['suggestive'],
    },
    threads: {
        platform: 'threads',
        description: 'Threads Guidelines — no nudity, hate speech, harassment',
        blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans', 'nsfw'],
        maxHashtags: 10,
        maxCaptionLength: 500,
        linksAllowed: false,
        reviewCategories: ['suggestive', 'revealing'],
    },
    snapchat: {
        platform: 'snapchat',
        description: 'Snapchat Community Guidelines — no explicit sexual content, no bullying',
        blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans', 'nsfw', 'harassment'],
        maxHashtags: 0,
        maxCaptionLength: 250,
        linksAllowed: false,
        reviewCategories: ['suggestive', 'revealing', 'intimate'],
    },
    discord: {
        platform: 'discord',
        description: 'Discord Community Guidelines — no hate speech, harassment, explicit content in non-NSFW channels',
        blockedKeywords: ['harassment', 'dox', 'gore'],
        maxHashtags: 0,
        maxCaptionLength: 2000,
        linksAllowed: true,
        reviewCategories: ['suggestive'],
    },
    telegram: {
        platform: 'telegram',
        description: 'Telegram Terms — no illegal content, spam, copyright infringement',
        blockedKeywords: ['spam', 'scam', 'illegal'],
        maxHashtags: 0,
        maxCaptionLength: 4096,
        linksAllowed: true,
        reviewCategories: [],
    },
    fanvue: {
        platform: 'fanvue',
        description: 'Fanvue ToS — no illegal content, no minors, platform-specific content rules',
        blockedKeywords: ['minor', 'underage', 'illegal'],
        maxHashtags: 50,
        maxCaptionLength: 5000,
        linksAllowed: true,
        reviewCategories: ['extremely_explicit'],
    },
};
// ─── ToS Risk Engine ───
export class ToSEngine {
    visionClient;
    thresholds;
    constructor(thresholds) {
        this.thresholds = { ...DEFAULT_PLATFORM_THRESHOLDS, ...thresholds };
        this.visionClient = new VisionEngineClient();
    }
    /**
     * Classify an image for ToS compliance using the local vision engine.
     */
    async classifyImage(imageData) {
        const result = await this.visionClient.callTosClassify(imageData);
        return {
            score: Math.round(result.score * 100),
            category: result.category,
            explanation: result.explanation,
        };
    }
    /**
     * Get the ToS score threshold for a specific platform.
     * Returns a value 0–100 where higher = more permissive.
     */
    getPlatformThreshold(platform) {
        return this.thresholds[platform] ?? DEFAULT_PLATFORM_THRESHOLDS[platform] ?? 70;
    }
    /**
     * Evaluate an asset for ToS compliance across multiple platforms.
     * Returns verdict, per-platform scores, and aggregated reasons.
     */
    async evaluate(asset, platforms) {
        const classification = await this.classifyImage(asset.imageData);
        const scores = [];
        const allReasons = new Set();
        for (const platform of platforms) {
            const threshold = this.getPlatformThreshold(platform);
            const rule = PLATFORM_RULES[platform];
            const reasons = [];
            // Score from image classification (0–100 where 0 = safe, 100 = violation)
            const imageScore = classification.score;
            // Check caption for blocked keywords
            const caption = asset.caption ?? '';
            const captionLower = caption.toLowerCase();
            const blockedInCaption = rule.blockedKeywords.filter((kw) => captionLower.includes(kw.toLowerCase()));
            if (blockedInCaption.length > 0) {
                reasons.push(`Caption contains blocked keywords: ${blockedInCaption.join(', ')}`);
            }
            // Check caption length
            if (caption.length > rule.maxCaptionLength) {
                reasons.push(`Caption exceeds ${rule.maxCaptionLength} character limit (${caption.length})`);
            }
            // Check hashtags
            const hashtags = asset.hashtags ?? [];
            if (hashtags.length > rule.maxHashtags) {
                reasons.push(`Hashtag count (${hashtags.length}) exceeds platform limit (${rule.maxHashtags})`);
            }
            // Check review categories
            if (classification.category &&
                rule.reviewCategories.includes(classification.category)) {
                reasons.push(`Image category "${classification.category}" requires review on ${platform}`);
            }
            // Build final score combining image classification and rule violations
            let finalScore = imageScore;
            if (blockedInCaption.length > 0) {
                // Boost score for keyword violations
                finalScore = Math.min(finalScore + blockedInCaption.length * 15, 100);
            }
            // Determine verdict
            let verdict;
            if (finalScore >= threshold + 15) {
                verdict = 'block';
            }
            else if (finalScore >= threshold) {
                verdict = 'review';
            }
            else {
                verdict = 'pass';
            }
            if (reasons.length > 0) {
                reasons.forEach((r) => allReasons.add(r));
            }
            scores.push({
                platform,
                score: Math.round(finalScore),
                threshold,
                verdict,
                reasons,
            });
        }
        // Aggregate verdict: block wins over review, review wins over pass
        const hasBlock = scores.some((s) => s.verdict === 'block');
        const hasReview = scores.some((s) => s.verdict === 'review');
        return {
            verdict: hasBlock ? 'block' : hasReview ? 'review' : 'pass',
            scores,
            reasons: Array.from(allReasons),
        };
    }
}
//# sourceMappingURL=tos-engine.js.map