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
import { validatePublish } from './validation.js';

const SNAP_BASE = 'https://kit.snapchat.com/v1';

export class SnapchatConnector extends BaseConnector implements SocialConnector {
  constructor(auth: ConnectorAuth, fetchImpl?: typeof fetch) {
    super('snapchat' as Platform, 'Snapchat', 'assisted' as PublishMode, auth, fetchImpl);
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
      // Assisted publishing does not receive a provider remote ID, so the
      // worker cannot collect Snapchat metrics for the resulting handoff.
      // Do not advertise an insights path that the production publish flow
      // cannot reach.
      metrics: [],
      refreshMetrics: false,
    };
  }

  async validate(input: ConnectorPublishInput): Promise<ValidationReport> {
    // Reuse the common media type/count contract. The assisted handoff may
    // still include an operator-facing caption even though Snapchat's direct
    // connector capability has no provider-side caption field, so disable only
    // the shared caption-length check and keep the existing warning below.
    const report = validatePublish(input, {
      ...this.capability(),
      maxCaptionLength: Number.MAX_SAFE_INTEGER,
    });

    if (input.caption && input.caption.length > 100) {
      report.warnings.push({
        field: 'caption',
        message: 'Snapchat captions limited to ~100 chars',
        severity: 'warning' as const,
      });
    }

    report.infos.push({
      field: 'general',
      message: 'Snapchat uses assisted publish — operator must tap to post',
      severity: 'info' as const,
    });
    report.tosVerdict = report.valid ? (report.warnings.length > 0 ? 'flag' : 'pass') : 'block';
    return report;
  }

  async publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult> {
    return this.idempotentPublish(input, async () => {
      const validation = await this.validate(input);
      if (!validation.valid) {
        throw new Error(
          `Snapchat assisted publish validation failed: ${validation.errors.map((error) => error.message).join('; ')}`,
        );
      }
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
