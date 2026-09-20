import { createHash } from 'node:crypto';
import { isLearningArm, isLearningContext, learningContextBucket, parseLearningArm } from '@axiom/core';
import type { ContentBundle } from '@/lib/api';
import { useLocale } from './LocaleProvider';

const armKeys: Record<string, string> = {
  'short:question': 'caption.shortQuestion', 'short:statement': 'caption.shortStatement',
  'medium:question': 'caption.mediumQuestion', 'medium:statement': 'caption.mediumStatement',
  'long:question': 'caption.longQuestion', 'long:statement': 'caption.longStatement',
};
function armLabel(arm: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  const parsed = parseLearningArm(arm);
  if (!parsed) return t('caption.unknownStructure');
  const base = armKeys[`${parsed.captionLength}:${parsed.captionShape}`]
    ? t(armKeys[`${parsed.captionLength}:${parsed.captionShape}`])
    : `${parsed.captionLength} ${parsed.captionShape} ${t('caption.unknown')}`;
  if (parsed.version === 'learn-v1') return base;
  return `${base} · ${parsed.hookType ?? t('caption.unknown')} ${t('caption.hook')} · ${parsed.format ?? t('caption.unknown')} ${t('caption.format')}`;
}
type Receipt = NonNullable<ContentBundle['captionGuidance']>[string];
function validReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== 'object') return false;
  const r = value as Receipt;
  return r.version === 'caption-guidance-v1' && typeof r.captionSha256 === 'string' && /^[a-f0-9]{64}$/.test(r.captionSha256)
    && (r.selectedArm === null || (typeof r.selectedArm === 'string' && isLearningArm(r.selectedArm)))
    && typeof r.context === 'string' && isLearningContext(r.context)
    && Array.isArray(r.exemplarIds) && r.exemplarIds.length <= 50 && r.exemplarIds.every(id => typeof id === 'string'
      && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id));
}

/** Server-rendered evidence summary. No exemplar text, identifiers or hashes are exposed. */
export default function CaptionGuidance({ captions, receipts }: {
  captions: Record<string, string>; receipts: ContentBundle['captionGuidance'];
}) {
  const { t } = useLocale();
  const entries = Object.entries(captions);
  if (!entries.length) return null;
  return <details className="card stack">
    <summary>{t('caption.guidance')}</summary>
    <p>{t('caption.guidanceDescription')}</p>
    {entries.map(([platform, caption]) => {
      const receipt = receipts?.[platform];
      if (!receipt) return <p key={platform}><strong>{platform}:</strong> {t('caption.noReceipt')}</p>;
      if (!validReceipt(receipt)) return <p key={platform}><strong>{platform}:</strong> {t('caption.invalidReceipt')}</p>;
      if (createHash('sha256').update(caption, 'utf8').digest('hex') !== receipt.captionSha256)
        return <p key={platform}><strong>{platform}:</strong> {t('caption.changed')}</p>;
      const bucket = learningContextBucket(receipt.context);
      return <div key={platform} className="stack">
        <h4>{platform}</h4>
        <p>{receipt.selectedArm ? armLabel(receipt.selectedArm, t) : t('caption.noStructure')}.</p>
        <p>{t('caption.priorExamples', { count: receipt.exemplarIds.length })}</p>
        <p>{bucket === 'unknown' || bucket === null ? t('caption.noScheduledContext')
          : t('caption.selectionContext', {
            from: String(Number(bucket) * 6).padStart(2, '0'),
            to: String(Number(bucket) * 6 + 5).padStart(2, '0'),
          })}</p>
      </div>;
    })}
  </details>;
}
