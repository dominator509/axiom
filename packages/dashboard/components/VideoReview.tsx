'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';

export default function VideoReview({ bundleId, scanId, platforms }: {
  bundleId: string; scanId: string; platforms: string[];
}) {
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
        setError('Review was not accepted. Refresh to check the current scan, media, and permissions.');
        return;
      }
      intent.current = null;
      router.refresh();
    } catch {
      setError('Review could not be confirmed. Retry unchanged to check the same request.');
    } finally { running.current = false; setBusy(false); }
  }
  return <fieldset disabled={busy} className="stack">
    <legend>Full-video compliance review</legend>
    <p>The automated scan samples two frames per second and does not assess audio. Watch the entire video with audio and inspect each destination’s caption before recording your decision. This is audited and does not publish or schedule the bundle.</p>
    <label><input type="checkbox" checked={watched} onChange={e => setWatched(e.target.checked)} /> I reviewed the entire video and its audio.</label>
    {platforms.map(platform => <label key={platform}>
      <input type="checkbox" checked={reviewed.includes(platform)} onChange={e => setReviewed(current =>
        e.target.checked ? [...current.filter(p => p !== platform), platform] : current.filter(p => p !== platform))} />
      I accept this video and caption for {platform}.
    </label>)}
    <label>Review rationale<textarea value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="btn secondary" disabled={!complete || busy} onClick={submit}>
      {busy ? 'Recording review…' : 'Record compliance review'}
    </button>
  </fieldset>;
}
