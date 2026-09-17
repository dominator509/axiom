import { createHash } from 'node:crypto';
import type { CaptionGuidanceReceipt } from '@axiom/db/schema';

const sha = (caption: string) => createHash('sha256').update(caption, 'utf8').digest('hex');
export function captionGuidanceReceipt(caption: string, selection: {
  selectedArm: string | null; context: string; exemplars: { id: string }[];
}): CaptionGuidanceReceipt {
  return { version: 'caption-guidance-v1', selectedArm: selection.selectedArm, context: selection.context,
    exemplarIds: selection.exemplars.map(item => item.id), captionSha256: sha(caption) };
}

/** Edited captions cannot inherit an earlier generation's guidance attribution. */
export function matchingCaptionGuidance(caption: string, receipt: CaptionGuidanceReceipt | undefined | null): CaptionGuidanceReceipt | null {
  return receipt?.version === 'caption-guidance-v1' && receipt.captionSha256 === sha(caption) ? receipt : null;
}
