'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';
import { approvalSlot } from '@/lib/schedule';

interface Props {
  bundleId: string;
  revisionId?: string;
  captions: Record<string, string>;
  hashtags: string[];
  publishIntent?: { action: string; platform: string; scheduledAt: string | null } | null;
}

export default function DraftEditor(props: Props) {
  const router = useRouter();
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
        if (!Object.keys(cleaned).length || Object.values(cleaned).some(value => !value || value.length > 10000)) throw new Error('Write a caption for each destination.');
        const hashtags = tags.split('\n').map(tag => tag.trim()).filter(Boolean);
        if (hashtags.length > 100 || hashtags.some(tag => tag.length > 100)) throw new Error('Use at most 100 hashtags, each at most 100 characters.');
        let scheduleRequest = null;
        if (scheduleMode === 'keep' && props.publishIntent?.action === 'schedule' && props.publishIntent.scheduledAt) {
          if (new Date(props.publishIntent.scheduledAt).getTime() <= Date.now()) throw new Error('The requested time has passed. Choose a new time or remove the request.');
          scheduleRequest = { platform: props.publishIntent.platform, scheduledAt: props.publishIntent.scheduledAt };
        } else if (scheduleMode === 'change') {
          const scheduledAt = approvalSlot(slot);
          if (!scheduledAt) throw new Error('Choose a future posting time.');
          scheduleRequest = { platform, scheduledAt };
        }
        intent.current = { key: createIdempotencyKey(), body: JSON.stringify({ expectedRevisionId: props.revisionId ?? null, captions: cleaned, hashtags, scheduleRequest }) };
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Check your draft.'); return; }
    }
    active.current = true; setBusy(true); setPending(true); setMessage('');
    try {
      const response = await mutationFetch(`/api/v1/bundles/${encodeURIComponent(props.bundleId)}/draft`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: intent.current.body },
        { idempotencyKey: intent.current.key, retries: 0 });
      if (!response.ok) {
        const error = await readDashboardError(response);
        setMessage(error?.error?.message ?? 'Saving was not confirmed.');
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
          setFinished(true); setMessage('This edit was not accepted. Reload the draft to check current access, content and revision before editing again.');
        }
        return;
      }
      const result = await readDashboardJson<{ data?: { id?: string; state?: string; tosReport?: { verdict?: string; revisionId?: string } } }>(response);
      const data = result.data;
      if (data?.id !== props.bundleId || data.state !== 'generated' || data.tosReport?.verdict !== 'pending'
        || !data.tosReport.revisionId || data.tosReport.revisionId === props.revisionId) throw new Error('Unconfirmed receipt');
      setFinished(true); setMessage('Draft saved. A fresh scan and approval are required. Nothing was published.');
      router.refresh();
    } catch { setMessage('Outcome unconfirmed. Retry the same edit to recover its result; do not create another request.'); }
    finally { active.current = false; setBusy(false); }
  }

  return <details><summary>Edit draft</summary><div className="stack">
    <p>Update captions and request a posting time. Saving invalidates the previous scan and approval; it does not generate media or publish.</p>
    {props.publishIntent?.action === 'publish' && <p>The existing immediate-publication request will be cleared. An approver must choose what happens next.</p>}
    <fieldset className="stack" disabled={busy || pending || finished}>
      {Object.entries(captions).map(([key, value]) => <label key={key}>{key} caption<textarea maxLength={10000} value={value} onChange={event => setCaptions({ ...captions, [key]: event.target.value })} /></label>)}
      <label>Hashtags (one per line)<textarea value={tags} onChange={event => setTags(event.target.value)} /></label>
      <label>Posting request<select value={scheduleMode} onChange={event => setScheduleMode(event.target.value)}>
        <option value="keep">Keep existing requested time, if any</option><option value="change">Request a new time</option><option value="remove">Let the approver choose</option>
      </select></label>
      {scheduleMode === 'change' && <>
        <label>Requested destination<select value={platform} onChange={event => setPlatform(event.target.value)}>{Object.keys(captions).map(key => <option key={key} value={key}>{key}</option>)}</select></label>
        <label>Requested posting time (your local time)<input type="datetime-local" value={slot} onChange={event => setSlot(event.target.value)} /></label>
        <p>This is a request, not a scheduled publication. During a repeated daylight-saving hour, the first occurrence is used.</p>
      </>}
    </fieldset>
    <div className="action-row">
      {!finished && <button type="button" className="btn secondary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving draft…' : pending ? 'Retry same edit' : 'Save draft and rescan'}</button>}
      {finished && <button type="button" className="btn secondary" onClick={() => window.location.reload()}>Reload draft</button>}
    </div>
    {message && <p role="status">{message}</p>}
  </div></details>;
}
