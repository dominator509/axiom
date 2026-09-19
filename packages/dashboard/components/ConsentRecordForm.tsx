'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createIdempotencyKey, mutationFetch } from '@/lib/mutation';
import { readDashboardError, readDashboardJson } from '@/lib/response';

const DOC_KINDS = ['2257', 'model_release', 'id_verify', 'platform_consent'] as const;
export function consentPayload(data: FormData) {
  const value = (name: string) => String(data.get(name) ?? '').trim();
  const platform = value('platform'), subjectRef = value('subjectRef'), blobRef = value('blobRef'), sha256 = value('sha256').toLowerCase();
  const validFrom = value('validFrom'), validTo = value('validTo');
  const docKind = value('docKind');
  if (!platform || platform.length > 50) throw new Error('Enter a platform name of 1–50 characters.');
  if (!DOC_KINDS.includes(docKind as typeof DOC_KINDS[number])) throw new Error('Choose a document kind.');
  if (!subjectRef || subjectRef.length > 200 || !blobRef || blobRef.length > 1000) throw new Error('Enter the subject and encrypted document references.');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Enter the document SHA-256 as 64 hexadecimal characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || (validTo && !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) || (validTo && validTo < validFrom)) throw new Error('Enter a valid date range.');
  return { platform, docKind, subjectRef, blobRef, sha256, validFrom, ...(validTo ? { validTo } : {}) };
}

export default function ConsentRecordForm({ modelId }: { modelId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const active = useRef(false), intent = useRef<{ body: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (active.current) return; const form = event.currentTarget;
    setError(''); setMessage('');
    try { intent.current ??= { body: JSON.stringify(consentPayload(new FormData(form))), key: createIdempotencyKey() }; }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Check consent metadata.'); return; }
    active.current = true; setBusy(true);
    try {
      const request = intent.current;
      const response = await mutationFetch(`/api/v1/models/${encodeURIComponent(modelId)}/consent-records`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: request.body }, { idempotencyKey: request.key });
      if (!response.ok) { const details = await readDashboardError(response); if ([400, 401, 403, 404, 409, 422].includes(response.status)) intent.current = null; setError(details?.error?.message ?? 'Consent record was not saved.'); return; }
      const body = await readDashboardJson<{ data?: { modelId?: string } }>(response);
      if (body.data?.modelId && body.data.modelId !== modelId) throw new Error('Unexpected consent record identity');
      intent.current = null; form.reset(); setMessage('Consent metadata saved. Document bytes remain in the encrypted object store.'); router.refresh();
    } catch { setError('Save not confirmed. Retry the same consent record before changing fields.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <details><summary>Add consent metadata</summary><form className="stack" aria-label="Add consent metadata" onSubmit={submit}>
    <p className="subtle">This stores references and a digest only. Do not paste document contents or credentials here.</p>
    <fieldset className="stack" disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <label>Platform<input name="platform" required maxLength={50} placeholder="fanvue" /></label>
      <label>Document kind<select name="docKind" defaultValue="model_release">{DOC_KINDS.map(kind => <option key={kind}>{kind}</option>)}</select></label>
      <label>Subject reference<input name="subjectRef" required maxLength={200} /></label>
      <label>Encrypted document reference<input name="blobRef" required maxLength={1000} /></label>
      <label>SHA-256 digest<input name="sha256" required pattern="[0-9a-fA-F]{64}" maxLength={64} /></label>
      <label>Valid from<input name="validFrom" type="date" required /></label>
      <label>Valid to (optional)<input name="validTo" type="date" /></label>
    </fieldset>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save consent metadata'}</button>
  </form></details>;
}
