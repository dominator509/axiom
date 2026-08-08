import { type Platform } from '@axiom/core';
import { z } from 'zod';
import { ToSEngine, PLATFORM_RULES } from './tos-engine.js';
import { TokenKillerAssembler, type TokenKillerSegments } from './tokenkiller.js';

// ─── Prompt Config Schema ───

const PromptConfigSchema = z.object({
  /** System persona / tone direction */
  persona: z.string().optional().default('professional_friendly'),
  /** Key talking points to include */
  talkingPoints: z.array(z.string()).optional().default([]),
  /** Content angle or theme */
  angle: z.string().optional().default('default'),
  /** Emoji usage: 'minimal', 'moderate', 'heavy' */
  emojiStyle: z.enum(['minimal', 'moderate', 'heavy']).optional().default('moderate'),
  /** Call-to-action type */
  cta: z.string().optional().default('engagement'),
});

export type PromptConfig = z.infer<typeof PromptConfigSchema>;

// ─── Platform Content Limits ───

export interface PlatformLimits {
  maxCaptionChars: number;
  maxHashtags: number;
  hashtagStyle: 'inline' | 'trailing';
}

const PLATFORM_LIMITS: Record<Platform, PlatformLimits> = {
  instagram: { maxCaptionChars: 2200, maxHashtags: 30, hashtagStyle: 'trailing' },
  tiktok: { maxCaptionChars: 2200, maxHashtags: 20, hashtagStyle: 'trailing' },
  x: { maxCaptionChars: 4000, maxHashtags: 50, hashtagStyle: 'trailing' },
  youtube: { maxCaptionChars: 5000, maxHashtags: 15, hashtagStyle: 'trailing' },
  facebook: { maxCaptionChars: 63206, maxHashtags: 30, hashtagStyle: 'trailing' },
  reddit: { maxCaptionChars: 40000, maxHashtags: 0, hashtagStyle: 'trailing' },
  threads: { maxCaptionChars: 500, maxHashtags: 10, hashtagStyle: 'trailing' },
  snapchat: { maxCaptionChars: 250, maxHashtags: 0, hashtagStyle: 'trailing' },
  discord: { maxCaptionChars: 2000, maxHashtags: 0, hashtagStyle: 'trailing' },
  telegram: { maxCaptionChars: 4096, maxHashtags: 0, hashtagStyle: 'trailing' },
  fanvue: { maxCaptionChars: 5000, maxHashtags: 50, hashtagStyle: 'trailing' },
};

// ─── Generation Result Types ───

export interface PlatformContent {
  platform: Platform;
  caption: string;
  hashtags: string[];
  truncated: boolean;
  tokenKillerPrefix: string | null;
}

export interface ContentBundleResult {
  bundleId: string;
  contents: PlatformContent[];
  tosResult: {
    verdict: string;
    scores: Array<{ platform: string; score: number; threshold: number; verdict: string }>;
    reasons: string[];
  };
}

// ─── Content Generator ───

export class ContentGenerator {
  private tosEngine: ToSEngine;
  private tokenKiller: TokenKillerAssembler;

  constructor() {
    this.tosEngine = new ToSEngine();
    this.tokenKiller = new TokenKillerAssembler();
  }

  /**
   * Generate a full content bundle for a model across target platforms.
   *
   * For each platform:
   * 1. Generate platform-specific caption using prompt config
   * 2. Generate hashtag set, obeying platform limits
   * 3. Truncate to platform limits
   * 4. Run ToS evaluation
   * 5. Assemble TOKENKILLER prefix
   * 6. Return structured bundle
   */
  async generateBundle(
    modelId: string,
    promptConfig: PromptConfig,
    targetPlatforms: Platform[],
  ): Promise<ContentBundleResult> {
    const config = PromptConfigSchema.parse(promptConfig);
    const bundleId = this.generateBundleId(modelId);
    const contents: PlatformContent[] = [];

    for (const platform of targetPlatforms) {
      const limits = PLATFORM_LIMITS[platform];
      // Generate caption
      let caption = this.generateCaption(config, platform);
      const hashtags = this.generateHashtags(config, platform, limits.maxHashtags);

      // Append hashtags to caption
      if (limits.hashtagStyle === 'trailing' && hashtags.length > 0) {
        const hashtagStr = '\n\n' + hashtags.map((t) => `#${t}`).join(' ');
        caption += hashtagStr;
      } else if (limits.hashtagStyle === 'inline' && hashtags.length > 0) {
        // Inline: append at end with a space
        caption += ' ' + hashtags.map((t) => `#${t}`).join(' ');
      }

      // Truncate to platform limit
      let truncated = false;
      if (caption.length > limits.maxCaptionChars) {
        caption = caption.slice(0, limits.maxCaptionChars);
        truncated = true;
      }

      // Assemble TOKENKILLER prefix
      const segments: TokenKillerSegments = {
        S0: this.buildPersonaSegment(config, platform),
        S1: this.buildPlatformRulesSegment(platform),
        S2: '', // Viral exemplars — populated by retrieval pipeline
        S3: this.buildTaskVariablesSegment(config, modelId, platform),
      };
      const tokenKillerPrefix = this.tokenKiller.segmentPrompt(segments);

      contents.push({
        platform,
        caption,
        hashtags,
        truncated,
        tokenKillerPrefix,
      });
    }

    // Run ToS evaluation on the generated content
    const tosResult = await this.tosEngine.evaluate(
      {
        imageData: '', // Will be set by caller when image is available
        caption: contents.map((c) => c.caption).join('\n'),
        hashtags: contents.flatMap((c) => c.hashtags),
      },
      targetPlatforms,
    );

    return {
      bundleId,
      contents,
      tosResult: {
        verdict: tosResult.verdict,
        scores: tosResult.scores.map((s) => ({
          platform: s.platform,
          score: s.score,
          threshold: s.threshold,
          verdict: s.verdict,
        })),
        reasons: tosResult.reasons,
      },
    };
  }

  /**
   * Generate a platform-appropriate caption from the prompt config.
   */
  private generateCaption(config: PromptConfig, platform: Platform): string {
    const emojiMap: Record<string, string[]> = {
      minimal: [],
      moderate: ['✨', '🔥', '💫', '❤️', '👇'],
      heavy: [
        '✨',
        '🔥',
        '💫',
        '❤️',
        '👇',
        '🌟',
        '💥',
        '🎯',
        '⚡',
        '💯',
        '👑',
        '💎',
        '🚀',
        '💜',
        '⭐',
      ],
    };

    const emojis = emojiMap[config.emojiStyle] ?? emojiMap.moderate;

    // Build a basic caption from config
    const parts: string[] = [];

    // Opening based on platform
    if (platform === 'tiktok' || platform === 'instagram') {
      const emoji = emojis.length > 0 ? emojis[0] + ' ' : '';
      parts.push(`${emoji}New post just dropped!`);
    } else if (platform === 'x') {
      parts.push('Just shared something new.');
    } else if (platform === 'snapchat') {
      parts.push('New snap!');
    } else {
      parts.push(`New content!`);
    }

    // Talking points
    if (config.talkingPoints.length > 0) {
      for (const point of config.talkingPoints) {
        if (emojis.length > 1) {
          parts.push(`${emojis[1]} ${point}`);
        } else {
          parts.push(`• ${point}`);
        }
      }
    }

    // CTA based on config
    const ctaMap: Record<string, string> = {
      engagement: 'Let me know what you think in the comments! 👇',
      follow: "Don't forget to follow for more! ❤️",
      share: 'Share this with someone who needs to see it! 🔄',
      link: 'Check the link in bio for more! 🔗',
    };
    parts.push(ctaMap[config.cta] ?? ctaMap.engagement);

    return parts.join('\n\n');
  }

  /**
   * Generate a set of hashtags for a platform.
   */
  private generateHashtags(_config: PromptConfig, platform: Platform, max: number): string[] {
    const baseTags = ['newpost', 'contentcreator', 'trending'];
    const platformTags: Record<Platform, string[]> = {
      instagram: ['photooftheday', 'instadaily', 'picoftheday'],
      tiktok: ['fyp', 'foryou', 'viral'],
      x: ['trending', 'viral', 'now'],
      youtube: ['youtube', 'subscribe', 'content'],
      facebook: ['facebook', 'trending', 'share'],
      reddit: [],
      threads: ['threads', 'trending'],
      snapchat: [],
      discord: [],
      telegram: [],
      fanvue: ['fanvue', 'exclusive', 'premium'],
    };

    const allTags = [...baseTags, ...(platformTags[platform] ?? [])];

    // Deduplicate and limit
    const unique = [...new Set(allTags)];
    return unique.slice(0, Math.min(max || unique.length, unique.length));
  }

  /**
   * Build a persona segment for TOKENKILLER S0.
   */
  private buildPersonaSegment(config: PromptConfig, _platform: Platform): string {
    const personas: Record<string, string> = {
      professional_friendly:
        'You are a professional social media content creator. Your tone is friendly, approachable, and polished. You write engaging captions that connect with your audience while maintaining brand voice.',
      casual:
        'You speak naturally, like a friend chatting with their followers. Keep it real, keep it relatable.',
      hype: 'You are high-energy and enthusiastic. Every post radiates excitement and positivity. Get the audience hyped!',
      educational:
        'You are an expert educator who breaks down complex topics into engaging, easy-to-understand content. Your posts inform and inspire.',
      default:
        'You write engaging, authentic social media content that resonates with your audience.',
    };

    return personas[config.persona] ?? personas.default;
  }

  /**
   * Build the platform rules segment for TOKENKILLER S1.
   */
  private buildPlatformRulesSegment(platform: Platform): string {
    const rules = PLATFORM_RULES[platform];
    if (!rules) return '';

    const blocked = rules.blockedKeywords;
    const review = rules.reviewCategories;

    const parts: string[] = [`[PLATFORM: ${platform.toUpperCase()}]`];
    parts.push(`Description: ${rules.description}`);
    parts.push(`Max caption length: ${rules.maxCaptionLength} characters`);
    parts.push(`Max hashtags: ${rules.maxHashtags}`);
    parts.push(`Links allowed: ${rules.linksAllowed ? 'Yes' : 'No'}`);

    if (blocked.length > 0) {
      parts.push(`BLOCKED keywords: ${blocked.join(', ')}`);
    }
    if (review.length > 0) {
      parts.push(`REVIEW categories: ${review.join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Build the task variables segment for TOKENKILLER S3.
   */
  private buildTaskVariablesSegment(
    config: PromptConfig,
    modelId: string,
    platform: Platform,
  ): string {
    return [
      `[TASK]`,
      `Model ID: ${modelId}`,
      `Platform: ${platform}`,
      `Angle: ${config.angle}`,
      `Emoji style: ${config.emojiStyle}`,
      `CTA: ${config.cta}`,
      config.talkingPoints.length > 0 ? `Talking points: ${config.talkingPoints.join(' | ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Generate a unique bundle ID.
   */
  private generateBundleId(modelId: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `bundle_${modelId}_${timestamp}_${random}`;
  }
}
