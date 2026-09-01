// ─── Reddit Connector ───
// Uses the Reddit API (OAuth 2.0) for publishing, metrics, and token management.

import { BaseConnector } from './base.js';
import type {
  SocialConnector,
  ConnectorAuth,
  ConnectorPublishInput,
  ConnectorPublishResult,
  ConnectorCapability,
  ConnectorMetrics,
  MetricPeriod,
  ValidationReport,
  MediaType,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
import { validatePublish } from './validation.js';

const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_OAUTH_REVOKE = 'https://www.reddit.com/api/v1/revoke_token';

interface RedditSubmitResponse {
  json: {
    errors: string[][];
    data?: {
      id?: string;
      name?: string; // t3_xxxxx
      url?: string;
    };
  };
}

interface RedditAboutRulesResponse {
  rules: Array<{
    short_name: string;
    description: string;
    violation_reason?: string;
    created_utc?: number;
    priority?: number;
    description_html?: string;
  }>;
  site_rules: string[];
}

interface RedditInfoResponse {
  kind: string;
  data: {
    children: Array<{
      kind: string;
      data: {
        id: string;
        name: string;
        title: string;
        ups: number;
        downvotes?: number;
        score: number;
        num_comments: number;
        view_count?: number;
        url: string;
        permalink: string;
        created_utc: number;
      };
    }>;
  };
}

interface RedditRevokeResponse {
  success: boolean;
}

export class RedditConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('reddit' as Platform, 'Reddit', 'api' as PublishMode, auth, fetchImpl);
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['image' as MediaType, 'video' as MediaType],
      maxMediaBytes: 1_073_741_824, // 1 GB
      maxMediaCount: 1,
      caption: true,
      maxCaptionLength: 40_000,
      scheduling: 'internal' as const,
      metrics: ['views', 'likes', 'comments', 'shares'],
      refreshMetrics: true,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    return validatePublish(input, this.capability());
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const subreddit = (input.options?.subreddit as string) ?? '';
      if (!subreddit) {
        throw new Error('Reddit requires a subreddit in input.options.subreddit');
      }

      const accessToken = this.auth.accessToken;
      const mediaUrls = input.mediaUrls;
      const caption = input.caption;

      // Determine the kind of submission
      let kind: 'link' | 'self' | 'image' | 'video';
      let url: string | undefined;

      if (mediaUrls.length > 0) {
        const mediaUrl = mediaUrls[0];
        const mediaType = this.detectMediaType(mediaUrl);

        if (mediaType === 'video') {
          kind = 'video';
          url = mediaUrl;
        } else {
          kind = 'image';
          url = mediaUrl;
        }
      } else {
        // Text/link post
        const link = input.options?.link as string | undefined;
        kind = link ? 'link' : 'self';
        url = link;
      }

      // Build form data for the submit endpoint
      const formData = new URLSearchParams();
      formData.append('sr', subreddit);
      formData.append('kind', kind);
      formData.append('title', caption.slice(0, 300)); // Reddit max title length is 300

      if (kind === 'link' && url) {
        formData.append('url', url);
      } else if (kind === 'image' && url) {
        formData.append('url', url);
      } else if (kind === 'video' && url) {
        formData.append('url', url);
      }

      if (kind === 'self') {
        // Self posts use the text parameter
        formData.append('text', caption);
      }

      // Optional parameters
      if (input.options?.nsfw != null) {
        formData.append('nsfw', input.options.nsfw ? 'true' : 'false');
      }
      if (input.options?.spoiler != null) {
        formData.append('spoiler', input.options.spoiler ? 'true' : 'false');
      }
      if (input.options?.sendreplies != null) {
        formData.append('sendreplies', input.options.sendreplies ? 'true' : 'false');
      }
      if (input.options?.flairId) {
        formData.append('flair_id', input.options.flairId as string);
      }
      if (input.options?.flairText) {
        formData.append('flair_text', input.options.flairText as string);
      }

      // Only set resubmit if we have an idempotency key (for retry support)
      formData.append('resubmit', 'true');

      // Validate against subreddit rules before submitting
      const rulesViolations = await this.checkSubredditRules(subreddit, caption);
      if (rulesViolations.length > 0) {
        this.log('warn', 'publish', `Subreddit rules may be violated`, {
          subreddit,
          violations: rulesViolations,
        });
        // Continue anyway — the API will enforce strict rules
      }

      const submitResp = await this.fetchImpl(`${REDDIT_API_BASE}/api/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'axiom:connector:reddit:v0.1.0 (by /u/axiom)',
        },
        body: formData.toString(),
      });

      if (!submitResp.ok) {
        const submitBody = await submitResp.text().catch(() => '');
        throw new Error(`Reddit submit failed: HTTP ${submitResp.status} — ${submitBody}`);
      }

      const submitData = (await submitResp.json()) as RedditSubmitResponse;

      if (submitData.json.errors && submitData.json.errors.length > 0) {
        const errorMessages = submitData.json.errors.map((e) => e.join(': ')).join('; ');
        throw new Error(`Reddit submit rejected: ${errorMessages}`);
      }

      const remoteId = submitData.json.data?.name ?? submitData.json.data?.id ?? '';
      if (!remoteId) {
        throw new Error('Reddit did not return a post ID');
      }

      this.log('info', 'publish', `Reddit post published to r/${subreddit}`, {
        remoteId,
        kind,
        subreddit,
      });

      const postUrl =
        submitData.json.data?.url ??
        `https://www.reddit.com/r/${subreddit}/comments/${remoteId.replace('t3_', '')}/`;

      return {
        remoteId,
        state: 'published',
        postUrl,
      };
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    // Normalize remoteId — strip t3_ prefix if present, then re-add
    const normalizedId = remoteId.startsWith('t3_') ? remoteId : `t3_${remoteId}`;

    const url = `${REDDIT_API_BASE}/api/info?id=${normalizedId}`;

    const resp = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        'User-Agent': 'axiom:connector:reddit:v0.1.0 (by /u/axiom)',
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Reddit info fetch failed: HTTP ${resp.status} — ${body}`);
    }

    const data = (await resp.json()) as RedditInfoResponse;

    if (!data.data?.children || data.data.children.length === 0) {
      throw new Error(`Reddit post ${remoteId} not found`);
    }

    const post = data.data.children[0].data;

    // Reddit doesn't expose view_count on all posts (only for images/videos with RES)
    const views = post.view_count ?? 0;
    const likes = post.ups - (post.downvotes ?? 0);

    return {
      postId: remoteId,
      platform: this.platform,
      collectedAt: new Date().toISOString(),
      metrics: {
        views,
        likes: Math.max(likes, 0),
        comments: post.num_comments ?? 0,
        shares: 0, // Reddit doesn't expose share count via API
      },
      raw: {
        ups: post.ups,
        downvotes: post.downvotes,
        score: post.score,
        num_comments: post.num_comments,
        view_count: post.view_count,
        permalink: post.permalink,
      },
    };
  }

  async revoke(): Promise<void> {
    const accessToken = this.auth.accessToken;

    // Revoke the OAuth token
    const params = new URLSearchParams({
      token: accessToken,
      token_type_hint: 'access_token',
    });

    const clientId = (this.auth.extra?.clientId as string) ?? '';
    const clientSecret = (this.auth.extra?.clientSecret as string) ?? '';

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await this.fetchImpl(REDDIT_OAUTH_REVOKE, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'axiom:connector:reddit:v0.1.0 (by /u/axiom)',
      },
      body: params.toString(),
    });

    if (response.ok) {
      const result = (await response.json()) as RedditRevokeResponse;
      this.log('info', 'revoke', `Reddit OAuth token revoked`, { success: result.success });
    } else {
      const body = await response.text().catch(() => '');
      this.log('warn', 'revoke', `Reddit token revocation warned: ${response.status} — ${body}`);
    }

    // Clear cached auth data
    this.auth.accessToken = '';
    this.auth.refreshToken = undefined;
    this.auth.expiresAt = 0;
  }

  /**
   * Fetch subreddit rules and check for potential violations.
   * Returns an array of rule descriptions that may be violated.
   */
  private async checkSubredditRules(subreddit: string, content: string): Promise<string[]> {
    const violations: string[] = [];

    try {
      const url = `${REDDIT_API_BASE}/r/${subreddit}/about/rules`;

      const resp = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${this.auth.accessToken}`,
          'User-Agent': 'axiom:connector:reddit:v0.1.0 (by /u/axiom)',
        },
      });

      if (!resp.ok) {
        this.log(
          'warn',
          'checkSubredditRules',
          `Could not fetch rules for r/${subreddit}: HTTP ${resp.status}`,
        );
        return violations;
      }

      const rulesData = (await resp.json()) as RedditAboutRulesResponse;
      const rules = rulesData.rules ?? [];

      for (const rule of rules) {
        const ruleName = rule.short_name.toLowerCase();
        const ruleDesc = rule.description.toLowerCase();

        // Simple keyword-based heuristics — these are advisory only
        // The actual enforcement happens on Reddit's side

        // Check for content-length rules (e.g., "no low effort" posts with very short content)
        if (
          (ruleName.includes('effort') ||
            ruleDesc.includes('effort') ||
            ruleName.includes('quality')) &&
          content.trim().length < 50
        ) {
          violations.push(rule.short_name);
          continue;
        }

        // Check for spam rules if content contains URL-like patterns
        if (
          (ruleName.includes('spam') ||
            ruleDesc.includes('spam') ||
            ruleName.includes('self-promotion')) &&
          (content.match(/https?:\/\/[^\s]+/g)?.length ?? 0) > 1
        ) {
          violations.push(rule.short_name);
          continue;
        }

        // Check for title formatting rules
        if (
          (ruleName.includes('title') || ruleDesc.includes('title')) &&
          content === content.toUpperCase() &&
          content.length > 10
        ) {
          violations.push(rule.short_name);
        }
      }

      this.log('info', 'checkSubredditRules', `Checked ${rules.length} rules for r/${subreddit}`, {
        subreddit,
        rulesChecked: rules.length,
        potentialViolations: violations.length,
      });
    } catch (err) {
      this.log('warn', 'checkSubredditRules', `Error checking rules for r/${subreddit}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return violations;
  }

  /** Detect media type from URL extension */
  private detectMediaType(url: string): 'image' | 'video' {
    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
      const videoExts = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', 'gif']);
      return videoExts.has(ext) ? 'video' : 'image';
    } catch {
      return 'image';
    }
  }
}

export default RedditConnector;
