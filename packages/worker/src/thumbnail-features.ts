import type { ThumbnailFeatures } from '@axiom/db/schema';
import type { TrustedVisionAnalysis } from '@axiom/fanvue-mcp';

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= min && value <= max;
}

/** Return only the bounded fields allowed in immutable publication evidence. */
export function readTrustedThumbnailFeatures(
  value: unknown,
  expectedAssetId: string | null,
): ThumbnailFeatures | undefined {
  if (!value || typeof value !== 'object' || !expectedAssetId) return undefined;
  const input = value as Record<string, unknown>;
  const dimensions = input.dimensions;
  if (!dimensions || typeof dimensions !== 'object') return undefined;
  const size = dimensions as Record<string, unknown>;
  const assetSha256 = input.assetSha256;
  const width = size.width;
  const height = size.height;
  if (
    input.version !== 'vision-analysis-v1'
    || input.source !== 'rust_engine'
    || input.assetId !== expectedAssetId
    || typeof assetSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(assetSha256)
    || !boundedInteger(width, 1, 10_000)
    || !boundedInteger(height, 1, 10_000)
    || !boundedNumber(input.confidence, 0, 1)
    || !boundedNumber(input.avgBrightness, 0, 255)
    || !boundedNumber(input.colorVariance, 0, 255)
    || !boundedNumber(input.aspectRatio, 0.01, 100)
  ) return undefined;
  return {
    version: 'vision-analysis-v1',
    source: 'rust_engine',
    assetId: expectedAssetId,
    assetSha256,
    confidence: input.confidence,
    dimensions: { width, height },
    avgBrightness: input.avgBrightness,
    colorVariance: input.colorVariance,
    aspectRatio: input.aspectRatio,
  };
}

export function makeTrustedThumbnailFeatures(
  visualAnalysis: TrustedVisionAnalysis | undefined,
  assetId: string | null,
  sha256: Buffer | undefined,
): ThumbnailFeatures | undefined {
  if (!visualAnalysis || !assetId || !Buffer.isBuffer(sha256) || sha256.length !== 32) return undefined;
  return readTrustedThumbnailFeatures({
    ...visualAnalysis,
    assetId,
    assetSha256: sha256.toString('hex'),
  }, assetId);
}
