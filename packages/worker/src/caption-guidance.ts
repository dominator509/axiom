import { createHash } from 'node:crypto';
import { sanitizeGuidanceEvidence, type GuidanceEvidence } from '@axiom/core';
import type { CaptionGuidanceReceipt } from '@axiom/db/schema';

const sha = (caption: string) => createHash('sha256').update(caption, 'utf8').digest('hex');
export function captionGuidanceReceipt(caption: string, selection: {
  selectedArm: string | null; context: string; exemplars: { id: string }[]; guidanceEvidence?: GuidanceEvidence | null;
}): CaptionGuidanceReceipt {
  const evidence = sanitizeGuidanceEvidence(selection.guidanceEvidence);
  return { version: 'caption-guidance-v1', selectedArm: selection.selectedArm, context: selection.context,
    exemplarIds: selection.exemplars.map(item => item.id), captionSha256: sha(caption),
    ...(evidence?.hookType ? { hookType: evidence.hookType } : {}),
    ...(evidence?.format ? { format: evidence.format } : {}),
    ...(evidence?.postingHourUtc !== undefined ? { postingHourUtc: evidence.postingHourUtc } : {}),
    ...(evidence?.timingBucket ? { timingBucket: evidence.timingBucket } : {}),
  };
}

/** Edited captions cannot inherit an earlier generation's guidance attribution. */
export function matchingCaptionGuidance(caption: string, receipt: CaptionGuidanceReceipt | undefined | null): CaptionGuidanceReceipt | null {
  return receipt?.version === 'caption-guidance-v1' && receipt.captionSha256 === sha(caption) ? receipt : null;
}
