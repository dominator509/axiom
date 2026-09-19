import { api, getSession } from '@/lib/api';
import { CATALOGS, LocaleCatalog, normalizeLocale } from '@axiom/core';
import RelayBindingManager from '@/components/RelayBindingManager';
import RelayCardHistory from '@/components/RelayCardHistory';

export const dynamic = 'force-dynamic';

export default async function RelayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ cards_cursor?: string | string[] }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  const query = searchParams ? await searchParams : {};
  const rawCursor = query.cards_cursor;
  const cardsCursor = Array.isArray(rawCursor) ? rawCursor[0] : rawCursor;

  let uiLocale = 'en';
  try { uiLocale = (await api.uiLocale.get()).data.locale; } catch { /* keep the safe fallback */ }
  const locale = normalizeLocale(uiLocale) ?? 'en';
  const copy = new LocaleCatalog(CATALOGS);
  const t = (key: string, values?: Record<string, string | number>) => copy.t(locale, key, values);

  let bindings = [] as Awaited<ReturnType<typeof api.models.relayBindings>>['data'];
  let cards = [] as Awaited<ReturnType<typeof api.models.relayCards>>['data'];
  let cardsMeta: Awaited<ReturnType<typeof api.models.relayCards>>['meta'] = { total: 0, limit: 20, next_cursor: null };
  let failed = false;
  let cardsFailed = false;
  try { bindings = (await api.models.relayBindings(id)).data; } catch { failed = true; }
  try {
    const response = await api.models.relayCards(id, cardsCursor);
    cards = response.data;
    cardsMeta = response.meta;
  } catch {
    cardsFailed = true;
  }
  return <div className="page-stack">
    <h2>{t('relay.title')}</h2>
    <div className="card">
      <h3>{t('relay.destinations.heading')}</h3>
      {failed ? <p role="alert">{t('relay.destinations.loadFailed')}</p> : <RelayBindingManager modelId={id} bindings={bindings} canEdit={canEdit} />}
    </div>
    <div className="card stack">
      <h3>{t('relay.history.heading')}</h3>
      <p className="subtle">{t('relay.history.subtle')}</p>
      {cardsFailed ? <p role="alert">{t('relay.history.loadFailed')}</p> : <RelayCardHistory modelId={id} cards={cards} nextCursor={cardsMeta.next_cursor} />}
    </div>
    <div className="card">
      <h3>{t('relay.howItWorks.heading')}</h3>
      <p className="subtle">{t('relay.howItWorks.description')}</p>
    </div>
  </div>;
}
