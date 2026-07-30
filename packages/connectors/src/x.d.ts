import { BaseConnector } from './base.js';
import type { SocialConnector, ConnectorAuth, ConnectorPublishInput, ConnectorPublishResult, ConnectorCapability, ConnectorMetrics, MetricPeriod, ValidationReport } from './types.js';
export declare class XConnector extends BaseConnector implements SocialConnector {
    constructor(auth: ConnectorAuth);
    capability(): ConnectorCapability;
    validate(input: ConnectorPublishInput): Promise<ValidationReport>;
    publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult>;
    fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics>;
    revoke(): Promise<void>;
    /**
     * Upload a single media file to X using the chunked upload API.
     * Downloads the media from the provided URL first, then performs
     * INIT → APPEND → FINALIZE.
     */
    private uploadMedia;
    /**
     * Poll media processing status for videos.
     */
    private pollMediaProcessing;
}
export default XConnector;
//# sourceMappingURL=x.d.ts.map