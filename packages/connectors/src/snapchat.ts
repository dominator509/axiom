// ─── Snapchat Connector (assisted publish) ───
// Snapchat has no open publish API → uses Relay hand-off (assisted mode)

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

const SNAP_BASE = 'https://kit.snapchat.com/v1';

export class SnapchatConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth) {
    super('snapchat' as Platform, 'Snapchat', 'assisted' as PublishMode, auth);
  }

  capability(): ConnectorCapability {
    return {
      publish: true,
      media: ['image' as MediaType, 'video' as MediaType, 'story' as MediaType],
      maxMediaBytes: 32_000_000,
      maxMediaCount: 10,
      caption: false,
      maxCaptionLength: 0,
      scheduling: 'none' as const,
      metrics: ['views' as const, 'impressions' as const],
      refreshMetrics: false,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    const errors: Array<{ field: string; message: string; severity: 'error' }> = [];
    const warnings: Array<{ field: string; message: string; severity: 'warning' }> = [];

    if (!input.mediaUrls || input.mediaUrls.length === 0) {
      errors.push({ field: 'mediaUrls', message: 'Snapchat requires at least one media', severity: 'error' as const });
    }
    if (input.caption && input.caption.length > 100) {
      warnings.push({ field: 'caption', message: 'Snapchat captions limited to ~100 chars', severity: 'warning' as const });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      infos: [{ field: 'general', message: 'Snapchat uses assisted publish — operator must tap to post', severity: 'info' as const }],
      tosVerdict: 'pass' as const,
    };
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      this.log('info', 'publish', `Snapchat assisted publish: relay card needed`);
      return {
        remoteId: null,
        state: 'skipped',
        error: 'Assisted publish: relay card sent to operator for manual tap',
        postUrl: undefined,
      };
    });
  }

  async fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics> {
    const metrics = await this.apiGet<{ views: number; impressions: number }>(
      `${SNAP_BASE}/media/${remoteId}/insights`,
    );
    return {
      postId: remoteId,
      platform: 'snapchat' as Platform,
      collectedAt: new Date().toISOString(),
      metrics: { views: metrics.views, impressions: metrics.impressions },
    };
  }

  async revoke(): Promise<void> {
    await this.apiDelete(`${SNAP_BASE}/oauth/revoke`, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    this.log('info', 'revoke', 'Snapchat access revoked');
  }
}
