import Link from 'next/link';
import { api, getSession } from '@/lib/api';
import { workspaceDestinationAllowed } from '@/lib/navigation-role';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function MyShiftsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const role = (await getSession())?.user?.role;
  const { t, dateTime } = await getServerLocale();
  if (!workspaceDestinationAllowed(role, '/shifts')) return <div className="card stack"><h1>{t('shifts.accessUnavailable')}</h1><p>{t('shifts.accessUnavailableDescription')}</p><Link href="/">{t('shifts.back')}</Link></div>;
  const query = await searchParams;
  const cursor = typeof query?.cursor === 'string' ? query.cursor : undefined;
  let result: Awaited<ReturnType<typeof api.myShifts>> | undefined;
  try { result = await api.myShifts(cursor); } catch { /* No empty-roster claim on failure. */ }
  const now = Date.now();
  return <div className="page-stack">
    <h1>{t('shifts.title')}</h1>
    <p>{t('shifts.description')}</p>
    <p>{t('shifts.accessWarning')}</p>
    <form action="/shifts" className="action-row">
      {cursor && <input type="hidden" name="cursor" value={cursor} />}
      <button className="btn secondary" type="submit">{t('shifts.refresh')}</button>
    </form>
    {!result ? <p role="alert">{t('shifts.loadFailed')}</p>
      : result.data.length === 0 ? <p>{t('shifts.empty')} {t('shifts.emptyContact')}</p>
        : <div className="grid">{result.data.map(shift => {
          const start = Date.parse(shift.startsAt), end = Date.parse(shift.endsAt);
          const valid = Number.isFinite(start) && Number.isFinite(end) && end > start;
          const inWindow = valid && start <= now && now < end;
          const accessible = shift.status === 'active' && inWindow;
          return <article className="card stack" key={shift.id}>
            <h2>{shift.modelName}</h2>
            <p>{t('shifts.queue')}: {shift.queue}</p>
            <p>{t('shifts.recordedStatus')}: <strong>{shift.status}</strong></p>
            {valid ? <p><time dateTime={shift.startsAt}>{dateTime(new Date(start))}</time> {t('shifts.timeTo')} <time dateTime={shift.endsAt}>{dateTime(new Date(end))}</time> ({t('shifts.utc')})</p> : <p role="alert">{t('shifts.invalidTime')}</p>}
            {shift.note && <div><h3>{t('shifts.handoffNotes')}</h3><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shift.note}</p></div>}
            {accessible ? <><p>{t('shifts.activeAtLoad')}</p><div className="action-row"><Link href={`/models/${encodeURIComponent(shift.modelId)}/inbox`} className="btn" prefetch={false}>{t('shifts.openInbox')}</Link><Link href={`/models/${encodeURIComponent(shift.modelId)}/fans`} className="btn secondary">{t('shifts.openFans')}</Link></div></>
              : <p>{valid && now >= end ? t('shifts.ended') : valid && now < start ? t('shifts.notStarted') : t('shifts.notActive')} {t('shifts.refreshAfterUpdate')}</p>}
          </article>;
        })}</div>}
    <nav className="action-row" aria-label={t('shifts.pages')}>
      {cursor && <Link href="/shifts">{t('shifts.firstPage')}</Link>}
      {result?.meta.next_cursor && <Link href={`/shifts?${new URLSearchParams({ cursor: result.meta.next_cursor })}`}>{t('shifts.nextPage')}</Link>}
    </nav>
  </div>;
}
