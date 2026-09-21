/** Wire shape of one model-scoped dynamic watermark policy. */
export interface WatermarkPolicyView {
  enabled: boolean;
  watermarkKey: string | null;
  position: string;
  opacity: number;
  scale: number;
}

export const WATERMARK_POSITION_ORDER = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const;

export const WATERMARK_OPACITY_MIN = 0;
export const WATERMARK_OPACITY_MAX = 100;
export const WATERMARK_SCALE_MIN = 5;
export const WATERMARK_SCALE_MAX = 100;

export const WATERMARK_KEY_PATTERN = /^generated\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/i;

export function absentWatermarkPolicy(): WatermarkPolicyView {
  return { enabled: false, watermarkKey: null, position: 'bottom-right', opacity: 60, scale: 100 };
}
