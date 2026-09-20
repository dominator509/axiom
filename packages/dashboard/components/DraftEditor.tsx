'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { approvalSlot } from '@/lib/schedule';
import { useLocale } from './LocaleProvider';

interface Props {
  bundleId: string;
  revisionId?: string;
  captions: Record<string, string>;
  hashtags: string[];
  publishIntent?: { action: string; platform: string; scheduledAt: string | null } | null;
}

export default function DraftEditor(props: Props) {
  const router = useRouter();
  const { t } = useLocale();
  const [captions, setCaptions] = useState(props.captions);
  const [tags, setTags] = useState(props.hashtags.join('\n'));
  const [scheduleMode, setScheduleMode] = useState('keep');
  const [platform, setPlatform] = useState(props.publishIntent?.platform ?? Object.keys(props.captions)[0] ?? '');
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(false);
  const intent = useRef<{ body: string; key: string } | null>(null);

  async function save() {
    if (active.current || finished) return;
    if (!intent.current) {
      try {
        const cleaned = Object.fromEntries(Object.entries(captions).map(([key, value]) => [key, value.trim()]));
        if (!Object.keys(cleaned).length || Object.values(cleaned).some(value => !value || value.length > 10000)) throw new Error(t('review.draftCaptionRequired'));
        const hashtags = tags.split('\n').map(tag => tag.trim()).filter(Boolean);
        if (hashtags.length > 100 || hashtags.some(tag => tag.length > 100)) throw new Error(t('review.draftHashtagLimit'));
        let scheduleRequest = null;
        if (scheduleMode === 'keep' && props.publishIntent?.action === 'schedule' && props.publishIntent.scheduledAt) {
          if (new Date(props.publishIntent.scheduledAt).getTime() <= Date.now()) throw new Error(t('review.draftPastSchedule'));
          scheduleRequest = { platform: props.publishIntent.platform, scheduledAt: props.publishIntent.scheduledAt };
        } else if (scheduleMode === 'change') {
          const scheduledAt = approvalSlot(slot);
          if (!scheduledAt) throw new Error(t('review.draftFutureSchedule'));
          scheduleRequest = { platform, scheduledAt };
        }
        intent.current = { key: createIdempotencyKey(), body: JSON.stringify({ expectedRevisionId: props.revisionId ?? null, captions: cleaned, hashtags, scheduleRequest }) };
      } catch (error) { setMessage(error instanceof Error ? error.message : t('review.checkDraft')); return; }
    }
    active.current = true; setBusy(true); setPending(true); setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/bundles/${encodeURIComponent(props.bundleId)}/draft`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: intent.current.body },
        { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        setMessage(error?.error?.message ?? t('review.draftSaveUnconfirmed'));
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          setFinished(true); setMessage(t('review.draftEditRejected'));
        }
        return;
      }
      const result = await readDashboardJson<{ data?: { id?: string; state?: string; tosReport?: { verdict?: string; revisionId?: string } } }>(response);
      const data = result.data;
      if (data?.id !== props.bundleId || data.state !== 'generated' || data.tosReport?.verdict !== 'pending'
        || !data.tosReport.revisionId || data.tosReport.revisionId === props.revisionId) throw new Error(t('review.draftOutcomeUnconfirmed'));
      setFinished(true); setMessage(t('review.draftSaved'));
      router.refresh();
    } catch { setMessage(t('review.draftOutcomeUnconfirmed')); }
    finally { active.current = false; setBusy(false); }
  }

  return <details><summary>{t('review.draftEditorTitle')}</summary><div className="stack">
    <p>{t('review.draftEditorDescription')}</p>
    {props.publishIntent?.action === 'publish' && <p>{t('review.draftPublishIntentWarning')}</p>}
    <fieldset className="stack" disabled={busy || pending || finished}>
      {Object.entries(captions).map(([key, value]) => <label key={key}>{t('review.destinationCaption', { destination: key })}<textarea maxLength={10000} value={value} onChange={event => setCaptions({ ...captions, [key]: event.target.value })} /></label>)}
      <label>{t('review.draftHashtags')}<textarea value={tags} onChange={event => setTags(event.target.value)} /></label>
      <label>{t('review.draftPostingRequest')}<select value={scheduleMode} onChange={event => setScheduleMode(event.target.value)}>
        <option value="keep">{t('review.draftKeepSchedule')}</option><option value="change">{t('review.draftNewSchedule')}</option><option value="remove">{t('review.draftApproverChoice')}</option>
      </select></label>
      {scheduleMode === 'change' && <>
        <label>{t('review.draftDestination')}<select value={platform} onChange={event => setPlatform(event.target.value)}>{Object.keys(captions).map(key => <option key={key} value={key}>{key}</option>)}</select></label>
        <label>{t('review.draftPostingTime')}<input type="datetime-local" value={slot} onChange={event => setSlot(event.target.value)} /></label>
        <p>{t('review.draftScheduleHelp')}</p>
      </>}
    </fieldset>
    <div className="action-row">
      {!finished && <button type="button" className="btn secondary" disabled={busy} onClick={() => void save()}>{busy ? t('review.savingDraft') : pending ? t('review.retryDraftEdit') : t('review.saveDraftRescan')}</button>}
      {finished && <button type="button" className="btn secondary" onClick={() => window.location.reload()}>{t('review.reloadDraft')}</button>}
    </div>
    {message && <p role="status">{message}</p>}
  </div></details>;
}
