'use client';

import type { VariantGuidanceSummary as Guidance } from '@/lib/api';
import { useLocale } from './LocaleProvider';

export default function VariantGuidanceSummary({ guidance }: { guidance?: Guidance | null }) {
  const { t } = useLocale();
  if (!guidance) return <p className="subtle">{t('variant.guidance.summaryUnavailable')}</p>;
  const details = [guidance.hookType && `${t('variant.detail.hook')}: ${guidance.hookType}`, guidance.format && `${t('variant.detail.format')}: ${guidance.format}`, guidance.postingHourUtc !== undefined && `${t('variant.detail.hour')}: ${guidance.postingHourUtc}:00 UTC`, guidance.timingBucket && `${t('variant.detail.timing')}: ${guidance.timingBucket}`].filter(Boolean).join(' · ');
  return <div className="stack"><strong>{t('variant.guidance.verified')}</strong><span className="subtle">{guidance.selectedArm ?? t('variant.guidance.none')} · {details || t('variant.guidance.none')}</span><span className="subtle">{t('variant.guidance.sourceBundle', { id: guidance.sourceBundleId.slice(0, 8) })} · {t('variant.guidance.provenance')}</span></div>;
}
