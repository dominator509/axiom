import { BaseConnector } from './base.js';
import type { SocialConnector, ConnectorAuth, ConnectorPublishInput, ConnectorPublishResult, ConnectorCapability, ConnectorMetrics, MetricPeriod, ValidationReport } from './types.js';
export declare class FanvueConnector extends BaseConnector implements SocialConnector {
    private modelId;
    private refreshToken?;
    private readonly clientId?;
    private readonly clientSecret?;
    private readonly tokenExpiresAt?;
    constructor(auth: ConnectorAuth);
    capability(): ConnectorCapability;
    /**
     * Exchange the refresh token for a fresh access token using the Ory token
     * endpoint. Returns the new access token and expiry (epoch seconds).
     * Throws if refresh credentials are absent or the exchange fails.
     */
    refreshAccessToken(): Promise<{
        accessToken: string;
        expiresAt: number;
    }>;
    /** Whether a stored refresh token is usable. */
    canRefresh(): boolean;
    /** Refresh if the current token is expired (or within 60s of expiry). */
    private ensureFreshToken;
    private fanvueHeaders;
    private fanvueRequest;
    /** Determine media type from a URL path extension (defaults to image). */
    private mediaTypeFromUrl;
    /** Download remote media bytes (bounded) for the multipart upload. */
    private downloadMedia;
    /**
     * Upload one remote media URL via the documented multipart flow and return
     * the mediaUuid. Requires the creator uuid for the presigned part URLs.
     */
    private uploadMedia;
    validate(input: ConnectorPublishInput): Promise<ValidationReport>;
    publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult>;
    fetchMetrics(remoteId: string, _period?: MetricPeriod): Promise<ConnectorMetrics>;
    revoke(): Promise<void>;
}
//# sourceMappingURL=fanvue.d.ts.map