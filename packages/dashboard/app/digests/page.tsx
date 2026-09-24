import Link from 'next/link';
import { api, getSession } from '@/lib/api';
import { CATALOGS, LocaleCatalog, formatDate, normalizeLocale } from '@axiom/core';
import GenerateDigestButton from '@/components/GenerateDigestButton';
import DigestScheduleStatus from '@/components/DigestScheduleStatus';
export const dynamic = 'force-dynamic';
/**
 * The API returns `externalDelivery` on each digest card (packages/api/src/routes/digests.ts),
 * but the dashboard's hand-written list return type in lib/api.ts does not yet declare it.
 * Read it through a narrow optional accessor so the truthful stored-vs-external wording holds
 * without depending on that out-of-scope declaration.
 */
function externalDeliveryOf(card: object): 'not-attempted' | 'attempted' | undefined {
  const value = (card as { externalDelivery?: unknown }).externalDelivery;
  return value === 'not-attempted' || value === 'attempted' ? value : undefined;
}

function digestCreatedAt(value: string, locale: Parameters<typeof formatDate>[1]): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? '—'
    : formatDate(parsed, locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
}

export default async function DigestsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession(); const canGenerate = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? ''); const query = await searchParams;
  const cursor = typeof query?.cursor === 'string' ? query.cursor : undefined;

  let uiLocale = 'en';
  try { uiLocale = (await api.uiLocale.get()).data.locale; } catch { /* keep the safe fallback */ }
  const locale = normalizeLocale(uiLocale) ?? 'en';
  const copy = new LocaleCatalog(CATALOGS);
  const t = (key: string, values?: Record<string, string | number>) => copy.t(locale, key, values);

  let result: Awaited<ReturnType<typeof api.digests.list>> | undefined;
  try { result = await api.digests.list(cursor); } catch { /* Render a distinct unavailable state. */ }
  return <div className="page-stack"><div className="row" style={{ justifyContent: 'space-between' }}><h1>{t('digest.title')}</h1><Link href="/audit">{t('digest.viewAuditTrail')}</Link></div>
    <p>{t('digest.description')}</p>
    <DigestScheduleStatus schedule={result?.schedule} canConfigure={session?.user?.role === 'owner'} />
    {canGenerate && <GenerateDigestButton />}
    {!canGenerate && <p className="subtle">{t('digest.requiresRole')}</p>}
    {!result ? <p role="alert">{t('digest.loadFailed')}</p> : result.data.length === 0 ? <p>{t('digest.empty')}</p> : <div className="grid">{result.data.map(card => <article className="card stack" key={card.id}><div className="row" style={{ justifyContent: 'space-between' }}><h2>{card.title || t('digest.untitled')}</h2><span className="badge mute">{externalDeliveryOf(card) === 'not-attempted' ? t('digest.storedOnly') : externalDeliveryOf(card) === 'attempted' ? t('digest.dispatchAttempted') : t('digest.outcomeUnknown')}</span></div><p style={{ whiteSpace: 'pre-wrap' }}>{card.description || t('digest.noSummary')}</p><p className="subtle">{t('digest.created', { value: digestCreatedAt(card.createdAt, locale) })}</p></article>)}</div>}
    <nav className="action-row" aria-label={t('digest.pages')}>{cursor && <Link href="/digests">{t('digest.latest')}</Link>}{result?.meta?.next_cursor && <Link href={`/digests?${new URLSearchParams({ cursor: result.meta.next_cursor })}`}>{t('digest.older')}</Link>}</nav>
  </div>;
}
