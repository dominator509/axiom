'use client';
import { useRef, useState } from 'react';
import * as React from 'react';
import { CATALOGS, LocaleCatalog, formatCurrency, formatDate, type SupportedLocale } from '@axiom/core';
import { readDashboardJson } from '@/lib/response';
import { useLocale } from './LocaleProvider';

const fallbackCatalog = new LocaleCatalog(CATALOGS);
const englishT = (key: string, values?: Record<string, string | number>) => fallbackCatalog.t('en', key, values);

/**
 * Direct component tests call this module without a renderer. Bind the live
 * provider only when React has an active dispatcher, otherwise keep the
 * deterministic English fallback used by those tests.
 */
function hasReactDispatcher(): boolean {
  const internals = (React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H?: unknown };
  }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  return Boolean(internals && internals.H);
}

function useInboxStrings(): { t: (key: string, values?: Record<string, string | number>) => string; locale: SupportedLocale } {
  const provider = hasReactDispatcher() ? useLocale() : undefined;
  return { t: provider?.t ?? englishT, locale: provider?.locale ?? 'en' };
}

interface Attachment {
  uuid: string; available: boolean; mediaType?: string; purchasedAt?: string | null;
  pricing?: { USD: { price: number } } | null; amountPaid?: { USD: { price: number } } | null;
  variants?: { variantType: string; width: number | null; height: number | null; lengthMs: number | null }[];
}
interface Scope { modelId: string; connectionId: string; userUuid: string; messageUuid: string; mediaUuids: string[] }
export function attachmentPreviewPath(scope: Scope, mediaUuid: string, variant: string) {
  return `/api/v1/models/${encodeURIComponent(scope.modelId)}/inbox?${new URLSearchParams({
    connectionId: scope.connectionId, userUuid: scope.userUuid, messageUuid: scope.messageUuid,
    mediaUuids: mediaUuid, preview: variant,
  })}`;
}

export function AttachmentPreview({ scope, item }: { scope: Scope; item: Attachment }) {
  const { t } = useInboxStrings();
  const [variant, setVariant] = useState('main'), [shown, setShown] = useState(false), [failed, setFailed] = useState(false);
  const supported = item.available && ['image', 'video', 'audio'].includes(item.mediaType ?? '');
  if (!supported) return <p>{t('inbox.attachmentPreviewTypeUnsupported')}</p>;
  const options = [...new Set((item.variants ?? []).map(v => v.variantType))];
  if (options.length === 0) return <p>{t('inbox.attachmentPreviewNoVariant')}</p>;
  const selected = options.includes(variant) ? variant : options[0];
  const src = attachmentPreviewPath(scope, item.uuid, selected);
  const type = selected === 'main' ? item.mediaType : 'image';
  const onError = () => { setFailed(true); setShown(false); };
  return <div className="stack">
    <label>{t('inbox.attachmentPreviewVariant')}<select value={selected} onChange={event => { setVariant(event.target.value); setShown(false); setFailed(false); }}>
      {options.map(option => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
    </select></label>
    <div className="action-row"><button type="button" className="btn secondary" onClick={() => { setFailed(false); setShown(!shown); }}>
      {shown ? t('inbox.attachmentPreviewHide') : failed ? t('inbox.attachmentPreviewRetry') : t('inbox.attachmentPreviewShow')}</button></div>
    {failed && <p role="alert">{t('inbox.attachmentPreviewUnavailable')}</p>}
    {shown && (type === 'video' ? <video controls playsInline preload="metadata" src={src} onError={onError} style={{ width: '100%', maxHeight: '65vh' }} />
      : type === 'audio' ? <audio controls preload="metadata" src={src} onError={onError} />
      // Authenticated byte proxy must not go through the public Next image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={src} alt={t('inbox.attachmentPreviewAlt')} onError={onError} style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }} />)}
  </div>;
}
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
  const { t, locale } = useInboxStrings();
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
    } catch { setError(t('inbox.attachmentDetailsLoadFailed')); }
    finally { active.current = false; setBusy(false); }
  }
  const money = (cents: number) => formatCurrency(cents / 100, locale, 'USD');
  const purchaseTime = (value: string) => formatDate(new Date(value), locale, {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  });
  return <section className="stack" aria-label={t('inbox.attachmentDetails')}>
    <p>{t('inbox.attachmentSummary', { count: scope.mediaUuids.length })}</p>
    <div className="action-row"><button type="button" className="btn secondary" onClick={load}
      disabled={busy || scope.mediaUuids.length === 0 || scope.mediaUuids.length > 20}>{busy ? t('inbox.loadingAttachmentDetails') : t('inbox.loadAttachmentDetails')}</button></div>
    {error && <p role="alert">{error}</p>}
    {items && <div aria-live="polite">{items.map((item, index) => <div className="card stack" key={item.uuid}>
      <h4>{item.available ? t('inbox.attachmentLabel', { count: index + 1, type: item.mediaType ?? 'unknown' })
        : t('inbox.attachmentUnavailableLabel', { count: index + 1 })}</h4>
      {item.available && <>
        {item.pricing && <p>{t('inbox.listedPrice', { price: money(item.pricing.USD.price) })}</p>}
        {item.amountPaid && <p>{t('inbox.amountPaid', { price: money(item.amountPaid.USD.price) })}</p>}
        <p>{item.purchasedAt && Number.isFinite(Date.parse(item.purchasedAt))
          ? t('inbox.purchaseRecorded', { time: purchaseTime(item.purchasedAt) }) : t('inbox.noPurchaseDate')}</p>
        <AttachmentPreview scope={scope} item={item} />
      </>}
    </div>)}</div>}
  </section>;
}
