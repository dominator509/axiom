/**
 * Shared F-14 watermark-policy contract constants.
 *
 * These are the single source of truth for the bounded shapes the API, the
 * dashboard, and the media-plane request builder all agree on. The database
 * CHECK constraints in migration 0063 encode the same bounds.
 */

export const WATERMARK_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const WATERMARK_POSITION_DEFAULT: WatermarkPosition = 'bottom-right';
export const WATERMARK_OPACITY_MIN = 0;
export const WATERMARK_OPACITY_MAX = 100;
export const WATERMARK_SCALE_MIN = 5;
export const WATERMARK_SCALE_MAX = 100;

/** Canonical tenant/model asset-key shape; scope equality is checked at the boundary. */
export const WATERMARK_KEY_PATTERN = /^generated\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/i;

export interface WatermarkPolicyView {
  enabled: boolean;
  watermarkKey: string | null;
  position: string;
  opacity: number;
  scale: number;
}

/** The policy a model uses when no row exists: no watermark is composited. */
export const ABSENT_WATERMARK_POLICY: WatermarkPolicyView = {
  enabled: false,
  watermarkKey: null,
  position: WATERMARK_POSITION_DEFAULT,
  opacity: 60,
  scale: 100,
};

/**
 * Bounds-check a watermark policy and return the media-plane fields for it, or
 * null when the policy must fail closed (disabled, or any value out of range).
 */
export function watermarkTransformFields(policy: WatermarkPolicyView): {
  position: string;
  opacity: number;
  scale: number;
} | null {
  if (!policy.enabled || policy.watermarkKey === null) return null;
  if (!WATERMARK_POSITIONS.includes(policy.position as WatermarkPosition)) return null;
  if (!Number.isInteger(policy.opacity) || policy.opacity < WATERMARK_OPACITY_MIN || policy.opacity > WATERMARK_OPACITY_MAX) return null;
  if (!Number.isInteger(policy.scale) || policy.scale < WATERMARK_SCALE_MIN || policy.scale > WATERMARK_SCALE_MAX) return null;
  if (!WATERMARK_KEY_PATTERN.test(policy.watermarkKey)) return null;
  return { position: policy.position, opacity: policy.opacity, scale: policy.scale };
}
