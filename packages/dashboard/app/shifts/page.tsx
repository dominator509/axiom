import Link from 'next/link';
import { api, getSession } from '@/lib/api';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';

export const dynamic = 'force-dynamic';

export default async function MyShiftsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const role = (await getSession())?.user?.role;
  if (!workspaceDestinationAllowed(role, '/shifts')) return <div className="card stack"><h1>Shift access unavailable</h1><p>Your role does not include a personal shift roster.</p><Link href="/">Back to workspace</Link></div>;
  const query = await searchParams;
  const cursor = typeof query?.cursor === 'string' ? query.cursor : undefined;
  let result: Awaited<ReturnType<typeof api.myShifts>> | undefined;
  try { result = await api.myShifts(cursor); } catch { /* No empty-roster claim on failure. */ }
  const now = Date.now();
  return <div className="page-stack">
    <h1>My shifts</h1>
    <p>Your own shifts for currently assigned talent, ordered by start time. All times below are UTC.</p>
    <p>Seeing an assignment does not start the shift or grant early access. An operator manages shift status. The saved fan CRM is not a synchronized live DM inbox.</p>
    <form action="/shifts" className="action-row">
      {cursor && <input type="hidden" name="cursor" value={cursor} />}
      <button className="btn secondary" type="submit">Refresh roster</button>
    </form>
    {!result ? <p role="alert">Your shifts could not be loaded. Refresh or return to the first page; no shift status has been changed.</p>
      : result.data.length === 0 ? <p>No assigned shifts on this page. Contact your workspace operator if an assignment is missing.</p>
        : <div className="grid">{result.data.map(shift => {
          const start = Date.parse(shift.startsAt), end = Date.parse(shift.endsAt);
          const valid = Number.isFinite(start) && Number.isFinite(end) && end > start;
          const inWindow = valid && start <= now && now < end;
          const accessible = shift.status === 'active' && inWindow;
          return <article className="card stack" key={shift.id}>
            <h2>{shift.modelName}</h2>
            <p>Queue: {shift.queue}</p>
            <p>Recorded status: <strong>{shift.status}</strong></p>
            {valid ? <p><time dateTime={shift.startsAt}>{new Date(start).toISOString()}</time> to <time dateTime={shift.endsAt}>{new Date(end).toISOString()}</time> (UTC)</p> : <p role="alert">Shift time is invalid. Contact your operator.</p>}
            {shift.note && <div><h3>Handoff notes</h3><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shift.note}</p></div>}
            {accessible ? <><p>Active within its time window at page load. Access is checked again when you open the workspace.</p><Link href={`/models/${encodeURIComponent(shift.modelId)}/fans`} className="btn secondary">Open assigned fan CRM</Link></>
              : <p>{valid && now >= end ? 'The time window has ended.' : valid && now < start ? 'The time window has not started.' : 'This shift is not active.'} Refresh after an operator updates the roster.</p>}
          </article>;
        })}</div>}
    <nav className="action-row" aria-label="Shift roster pages">
      {cursor && <Link href="/shifts">First page</Link>}
      {result?.meta.next_cursor && <Link href={`/shifts?${new URLSearchParams({ cursor: result.meta.next_cursor })}`}>Next shifts</Link>}
    </nav>
  </div>;
}
