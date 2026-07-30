import { BaseConnector } from './base.js';
import type { SocialConnector, ConnectorAuth, ConnectorPublishInput, ConnectorPublishResult, ConnectorCapability, ConnectorMetrics, MetricPeriod, ValidationReport } from './types.js';
export declare class SnapchatConnector extends BaseConnector implements SocialConnector {
    constructor(auth: ConnectorAuth);
    capability(): ConnectorCapability;
    validate(input: ConnectorPublishInput): Promise<ValidationReport>;
    publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult>;
    fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics>;
    revoke(): Promise<void>;
}
//# sourceMappingURL=snapchat.d.ts.map