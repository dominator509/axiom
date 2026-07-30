import { BaseConnector } from './base.js';
import type { SocialConnector, ConnectorAuth, ConnectorPublishInput, ConnectorPublishResult, ConnectorCapability, ConnectorMetrics, MetricPeriod, ValidationReport } from './types.js';
export declare class TelegramConnector extends BaseConnector implements SocialConnector {
    private botToken;
    constructor(auth: ConnectorAuth);
    private get apiBase();
    capability(): ConnectorCapability;
    validate(input: ConnectorPublishInput): Promise<ValidationReport>;
    publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult>;
    fetchMetrics(_remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics>;
    revoke(): Promise<void>;
}
//# sourceMappingURL=telegram.d.ts.map