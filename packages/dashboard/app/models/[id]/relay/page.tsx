import { api, getSession } from '@/lib/api';
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
    <h2>Relay delivery</h2>
    <div className="card">
      <h3>Approval-card destinations</h3>
      {failed ? <p role="alert">Relay destinations could not be loaded. Refresh to try again; no saved binding was changed.</p> : <RelayBindingManager modelId={id} bindings={bindings} canEdit={canEdit} />}
    </div>
    <div className="card stack">
      <h3>Relay-card history</h3>
      <p className="subtle">Review the signed control cards recorded for this talent. A recorded card is not proof that an external channel delivered it.</p>
      {cardsFailed ? <p role="alert">Relay-card history could not be loaded. Refresh to try again; no card state was changed.</p> : <RelayCardHistory modelId={id} cards={cards} nextCursor={cardsMeta.next_cursor} />}
    </div>
    <div className="card">
      <h3>How this works</h3>
      <p className="subtle">Generation still passes through ToS review and dashboard approval. Relay only delivers a signed control card; it cannot bypass approval or publish by itself. If a channel adapter is not configured on the server, the worker keeps the job parked and reports the reason.</p>
    </div>
  </div>;
}
