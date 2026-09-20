'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { useLocale } from './LocaleProvider';

export default function VideoReview({ bundleId, scanId, platforms }: {
  bundleId: string; scanId: string; platforms: string[];
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [watched, setWatched] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);
  const complete = watched && platforms.length > 0 && platforms.every(p => reviewed.includes(p)) && reason.trim().length >= 10;
  async function submit() {
    if (!complete || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const body = JSON.stringify({ scanId, platforms: reviewed, fullVideoAndAudioReviewed: true, reason: reason.trim() });
    if (intent.current?.body !== body) intent.current = { body, key: createIdempotencyKey() };
    try {
      const response = await mutationFetch(`/api/v1/bundles/${encodeURIComponent(bundleId)}/video-review`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      }, { idempotencyKey: intent.current.key });
      if (!response.ok) {
        setError(t('review.videoReviewRejected'));
        return;
      }
      intent.current = null;
      router.refresh();
    } catch {
      setError(t('review.videoReviewUnconfirmed'));
    } finally { running.current = false; setBusy(false); }
  }
  return <fieldset disabled={busy} className="stack">
    <legend>{t('review.videoReviewLegend')}</legend>
    <p>{t('review.videoReviewDescription')}</p>
    <label><input type="checkbox" checked={watched} onChange={e => setWatched(e.target.checked)} /> {t('review.videoReviewedConfirmation')}</label>
    {platforms.map(platform => <label key={platform}>
      <input type="checkbox" checked={reviewed.includes(platform)} onChange={e => setReviewed(current =>
        e.target.checked ? [...current.filter(p => p !== platform), platform] : current.filter(p => p !== platform))} />
      {t('review.videoCaptionAccept', { platform })}
    </label>)}
    <label>{t('review.reviewRationale')}<textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="btn secondary" disabled={!complete || busy} onClick={submit}>
      {busy ? t('review.recordingComplianceReview') : t('review.recordComplianceReview')}
    </button>
  </fieldset>;
}
