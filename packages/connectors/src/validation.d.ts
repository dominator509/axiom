import type { ConnectorPublishInput, ConnectorCapability, ValidationReport } from './types.js';
/**
 * Validate a publish input against a connector's capability declaration.
 *
 * Checks:
 * - Empty mediaUrls
 * - Per-media size against maxMediaBytes
 * - Media type against supported media[]
 * - Empty/missing caption against caption requirement
 * - Caption length against maxCaptionLength
 */
export declare function validatePublish(input: ConnectorPublishInput, cap: ConnectorCapability): ValidationReport;
//# sourceMappingURL=validation.d.ts.map