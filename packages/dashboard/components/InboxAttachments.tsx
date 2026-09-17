'use client';
import { useRef, useState } from 'react';
import { readDashboardJson } from '@/lib/response';

interface Attachment {
  uuid: string; available: boolean; mediaType?: string; purchasedAt?: string | null;
  pricing?: { USD: { price: number } } | null; amountPaid?: { USD: { price: number } } | null;
  variants?: { variantType: string; width: number | null; height: number | null; lengthMs: number | null }[];
}
interface Scope { modelId: string; connectionId: string; userUuid: string; messageUuid: string; mediaUuids: string[] }
export function validAttachmentReceipt(value: unknown, scope: Scope): value is { data: { inbox: { data: Attachment[] } } } {
  if (!value || typeof value !== 'object') return false;
  const data = (value as { data?: { connectionId?: unknown; userUuid?: unknown; inbox?: { kind?: unknown; messageUuid?: unknown; data?: unknown } } }).data;
  const inbox = data?.inbox;
  if (data?.connectionId !== scope.connectionId || data.userUuid !== scope.userUuid || inbox?.kind !== 'attachments'
    || inbox.messageUuid !== scope.messageUuid || !Array.isArray(inbox.data) || inbox.data.length !== scope.mediaUuids.length) return false;
  const price = (v: unknown) => v === null || (typeof v === 'object' && v !== null
    && Number.isSafeInteger((v as { USD?: { price?: number } }).USD?.price) && (v as { USD: { price: number } }).USD.price >= 0);
  const dimension = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
  return inbox.data.every((item: Attachment, index: number) => item && item.uuid === scope.mediaUuids[index]
    && (item.available === false || (item.available === true
      && ['image', 'video', 'audio', 'document', 'unknown'].includes(item.mediaType ?? '')
      && (item.purchasedAt === null || (typeof item.purchasedAt === 'string' && item.purchasedAt.length <= 64))
      && price(item.pricing) && price(item.amountPaid) && Array.isArray(item.variants) && item.variants.length <= 100
      && item.variants.every(v => v && ['main', 'thumbnail', 'thumbnail_gallery', 'blurred'].includes(v.variantType)
        && dimension(v.width) && dimension(v.height) && dimension(v.lengthMs)))));
}

export default function InboxAttachments(scope: Scope) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(false);
  async function load() {
    if (active.current) return;
    active.current = true; setBusy(true); setError(''); setItems(null);
    try {
      const query = new URLSearchParams({ connectionId: scope.connectionId, userUuid: scope.userUuid,
        messageUuid: scope.messageUuid, mediaUuids: scope.mediaUuids.join(',') });
      const response = await fetch(`/api/v1/models/${encodeURIComponent(scope.modelId)}/inbox?${query}`, {
        cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('unavailable');
      const result = await readDashboardJson<unknown>(response);
      if (!validAttachmentReceipt(result, scope)) throw new Error('invalid receipt');
      setItems(result.data.inbox.data);
    } catch { setError('Attachment details could not be verified. Check account access and your active shift, then retry.'); }
    finally { active.current = false; setBusy(false); }
  }
  const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return <section className="stack" aria-label="Message attachment details">
    <p>{scope.mediaUuids.length} attachment(s). Loading details does not purchase, download or mark them read.</p>
    <div className="action-row"><button type="button" className="btn secondary" onClick={load}
      disabled={busy || scope.mediaUuids.length === 0 || scope.mediaUuids.length > 20}>{busy ? 'Loading attachment details…' : 'Load attachment details'}</button></div>
    {error && <p role="alert">{error}</p>}
    {items && <div aria-live="polite">{items.map((item, index) => <div className="card stack" key={item.uuid}>
      <h4>Attachment {index + 1}{item.available ? ` · ${item.mediaType}` : ' · Unavailable'}</h4>
      {item.available && <>
        {item.pricing && <p>Listed price: {money(item.pricing.USD.price)}</p>}
        {item.amountPaid && <p>Amount paid: {money(item.amountPaid.USD.price)}</p>}
        <p>{item.purchasedAt ? `Purchase recorded: ${item.purchasedAt}` : 'No purchase date reported.'}</p>
        <p>{item.variants?.length ?? 0} provider variant(s). Image/video preview is not available yet.</p>
      </>}
    </div>)}</div>}
  </section>;
}
