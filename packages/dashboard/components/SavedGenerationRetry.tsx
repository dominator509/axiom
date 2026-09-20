'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import GenerationRetry from './GenerationRetry';
import { useLocale } from './LocaleProvider';

/** Persistent entry point from the review queue; the API decides eligibility. */
export default function SavedGenerationRetry({ modelId, bundleId, blocked }: {
  modelId: string; bundleId: string; blocked: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [queued, setQueued] = useState(false);
  if (queued) return <p role="status">{t('review.replacementQueued')}</p>;
  return <details>
    <summary>{t('review.retryOptionsSummary')}</summary>
    <p>{t('review.retryOptionsDescription')}</p>
    <GenerationRetry modelId={modelId} bundleId={bundleId} blocked={blocked} onQueued={() => {
      setQueued(true);
      router.refresh();
    }} />
  </details>;
}
