import { api, getSession } from '@/lib/api';
import RelayBindingManager from '@/components/RelayBindingManager';

export const dynamic = 'force-dynamic';

export default async function RelayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  let bindings = [] as Awaited<ReturnType<typeof api.models.relayBindings>>['data'];
  let failed = false;
  try { bindings = (await api.models.relayBindings(id)).data; } catch { failed = true; }
  return <div className="page-stack"><h2>Relay delivery</h2><div className="card"><h3>Approval-card destinations</h3>{failed ? <p role="alert">Relay destinations could not be loaded. Refresh to try again; no saved binding was changed.</p> : <RelayBindingManager modelId={id} bindings={bindings} canEdit={canEdit} />}</div><div className="card"><h3>How this works</h3><p className="subtle">Generation still passes through ToS review and dashboard approval. Relay only delivers a signed control card; it cannot bypass approval or publish by itself. If a channel adapter is not configured on the server, the worker keeps the job parked and reports the reason.</p></div></div>;
}
