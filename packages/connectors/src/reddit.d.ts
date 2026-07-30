import { BaseConnector } from './base.js';
import type { SocialConnector, ConnectorAuth, ConnectorPublishInput, ConnectorPublishResult, ConnectorCapability, ConnectorMetrics, MetricPeriod, ValidationReport } from './types.js';
export declare class RedditConnector extends BaseConnector implements SocialConnector {
    constructor(auth: ConnectorAuth);
    capability(): ConnectorCapability;
    validate(input: ConnectorPublishInput): Promise<ValidationReport>;
    publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult>;
    fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics>;
    revoke(): Promise<void>;
    /**
     * Fetch subreddit rules and check for potential violations.
     * Returns an array of rule descriptions that may be violated.
     */
    private checkSubredditRules;
    /** Detect media type from URL extension */
    private detectMediaType;
}
export default RedditConnector;
//# sourceMappingURL=reddit.d.ts.map