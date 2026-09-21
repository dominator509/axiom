import { api, getSession } from '@/lib/api';
import { getServerLocale } from '@/lib/server-locale';
import Link from 'next/link';
import PostScheduleForm from '@/components/PostScheduleForm';
import PostTeamNotes from '@/components/PostTeamNotes';
import PlaybookCadence, { currentUtcWeek } from '@/components/PlaybookCadence';
import CalendarBoard from '@/components/CalendarBoard';
import CalendarOptimalTimes from '@/components/CalendarOptimalTimes';
import type { PerformancePattern } from '@/components/PerformancePatterns';
import { talentDestinationAllowed } from '@/lib/navigation-role';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const session = await getSession();
  const { locale, t, dateTime } = await getServerLocale();
  const role = session?.user?.role;
  if (!talentDestinationAllowed(role, 'calendar')) return <div className="card"><h2>{t('calendar.accessUnavailable')}</h2><p>{t('calendar.accessDescription')}</p><Link href="/">{t('calendar.back')}</Link></div>;
  const showCadence = talentDestinationAllowed(role, 'playbook');
  const showReview = talentDestinationAllowed(role, 'approvals');
  const showTeamNotes = ['owner', 'manager', 'operator', 'analyst', 'agent', 'content_creator'].includes(role ?? '');
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  const query = await searchParams;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const requestedMonth = query?.month;
  const requestedView = query?.view;
  const requestedWeek = query?.week;
  const validMonth = typeof requestedMonth === 'string' &&
    /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(requestedMonth);
  const view = requestedView === 'week' ? 'week' : 'month';
  const invalidView = requestedView !== undefined && requestedView !== 'month' && requestedView !== 'week';
  const validWeek = typeof requestedWeek === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) && !Number.isNaN(new Date(`${requestedWeek}T00:00:00.000Z`).getTime());
  const invalidMonth = requestedMonth !== undefined && !validMonth;
  const invalidWeek = requestedWeek !== undefined && !validWeek;
  const month = validMonth ? requestedMonth : currentMonth;
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const selectedWeek = validWeek ? new Date(`${requestedWeek}T00:00:00.000Z`) : now;
  const weekStartDate = new Date(Date.UTC(selectedWeek.getUTCFullYear(), selectedWeek.getUTCMonth(), selectedWeek.getUTCDate()));
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - ((weekStartDate.getUTCDay() + 6) % 7));
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEndDate = new Date(weekStartDate.getTime() + 7 * 86_400_000 - 1);
  const from = view === 'week' ? weekStartDate.toISOString() : new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString();
  const to = view === 'week' ? weekEndDate.toISOString() : new Date(Date.UTC(year, monthNumber, 1) - 1).toISOString();
  const previous = new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
  const previousWeek = new Date(weekStartDate.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const nextWeek = new Date(weekStartDate.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const calendarPath = `/models/${encodeURIComponent(id)}/calendar`;
  const monthHref = (value: string) => `${calendarPath}?${new URLSearchParams({ month: value })}`;
  const weekHref = (value: string) => `${calendarPath}?${new URLSearchParams({ view: 'week', week: value })}`;
  const monthViewHref = `${calendarPath}?${new URLSearchParams({ view: 'month', month })}`;

  let posts: Awaited<ReturnType<typeof api.models.calendar>>['data'] = [];
  let error: string | null = null;
  try {
    posts = (await api.models.calendar(id, from, to)).data;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const week = currentUtcWeek(now);
  let guidelines: Awaited<ReturnType<typeof api.models.playbookGuidelines>>['data'] = [];
  let weekPosts: typeof posts = [];
  let viralPatterns: { groups: PerformancePattern[]; minimumSample: number } | undefined;
  let cadenceUnavailable = false;
  if (showCadence) try {
    const [saved, scheduled, viral] = await Promise.all([
      api.models.playbookGuidelines(id), api.models.calendar(id, week.from, week.to), api.models.viral(id),
    ]);
    guidelines = saved.data;
    weekPosts = scheduled.data;
    const candidate = viral.data as { patterns?: { groups?: PerformancePattern[]; minimumSample?: number } };
    const minimumSample = candidate.patterns?.minimumSample;
    if (candidate.patterns && Array.isArray(candidate.patterns.groups) && typeof minimumSample === 'number' && Number.isSafeInteger(minimumSample) && minimumSample > 0) {
      viralPatterns = { groups: candidate.patterns.groups, minimumSample };
    }
  } catch { cadenceUnavailable = true; }

  const viewLabel = t(view === 'month' ? 'calendar.month' : 'calendar.week');
  const stateLabels: Record<string, string> = {
    pending: t('calendar.state.pending'),
    published: t('calendar.state.published'),
    failed: t('calendar.state.failed'),
    canceled: t('calendar.state.canceled'),
    handed_off: t('calendar.state.handed_off'),
  };
  const stateLabel = (state: string) => stateLabels[state] ?? state;

  return (
    <div className="page-stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{t('calendar.title')}</h2>
        <span style={{ color: 'var(--muted)' }}>{error ? t('calendar.unavailable') : t('calendar.postsInView', { count: posts.length, noun: t(posts.length === 1 ? 'calendar.post' : 'calendar.posts'), view: viewLabel })}</span>
      </div>
      <nav className="row" aria-label={t('calendar.navigation')}>
        {view === 'month' ? <>
          {year > 1000 || monthNumber > 1 ? <Link href={monthHref(previous)}>{t('calendar.previousMonth')}</Link> : null}
          <strong>{month} ({t('calendar.utc')})</strong>
          {year < 9999 || monthNumber < 12 ? <Link href={monthHref(next)}>{t('calendar.nextMonth')}</Link> : null}
          {month !== currentMonth && <Link href={calendarPath}>{t('calendar.currentMonth')}</Link>}
        </> : <>
          <Link href={weekHref(previousWeek)}>{t('calendar.previousWeek')}</Link>
          <strong>{t('calendar.weekOf', { date: weekStart })}</strong>
          <Link href={weekHref(nextWeek)}>{t('calendar.nextWeek')}</Link>
          <Link href={weekHref(now.toISOString().slice(0, 10))}>{t('calendar.currentWeek')}</Link>
        </>}
        <Link href={monthViewHref}>{t('calendar.monthView')}</Link>
        <Link href={weekHref(weekStart)}>{t('calendar.weekView')}</Link>
      </nav>
      {view === 'month' && <form action={calendarPath} className="row">
        <label>{t('calendar.monthUtc')} <input type="month" name="month" defaultValue={month} min="1000-01" max="9999-12" required /></label>
        <button className="btn secondary" type="submit">{t('calendar.showMonth')}</button>
      </form>}
      {invalidMonth && <p role="alert">{t('calendar.invalidMonth')}</p>}
      {invalidWeek && <p role="alert">{t('calendar.invalidWeek')}</p>}
      {invalidView && <p role="alert">{t('calendar.invalidView')}</p>}
      {showCadence && <PlaybookCadence modelId={id} guidelines={guidelines} posts={weekPosts} {...week} unavailable={cadenceUnavailable} locale={locale} t={t} />}
      {showCadence && <CalendarOptimalTimes modelId={id} patterns={viralPatterns} />}
      {role === 'content_creator' && <p>{t('calendar.creatorProposalBefore')}<Link href={`/models/${encodeURIComponent(id)}/media`}>{t('calendar.mediaLibrary')}</Link>{t('calendar.creatorProposalAfter')}</p>}
      {error && (
        <div className="card" style={{ color: 'var(--bad)' }}>
          {t('calendar.loadFailed')}
        </div>
      )}
      {posts.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            {t('calendar.noScheduledPosts')} {canEdit ? t('calendar.approveGeneratedBundle') : t('calendar.approvedPlansAppear')}
          </p>
        </div>
      )}
      <CalendarBoard posts={posts} year={year} month={monthNumber} view={view} weekStart={weekStart} canEdit={canEdit} />
      <h3>{t('calendar.postDetails')}</h3>
      <div className="grid">
        {posts.map((p) => (
          <div key={p.id} id={`post-${p.id}`} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="mono">{p.platform}</span>
              <span
                className={`badge ${p.state === 'published' ? 'good' : p.state === 'failed' ? 'bad' : 'mute'}`}
              >
                {stateLabel(p.state)}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              {p.scheduledFor ? `${dateTime(new Date(p.scheduledFor))} (${t('calendar.utc')})` : t('calendar.notScheduled')}
            </div>
            {p.error && (
              <div style={{ color: 'var(--bad)', marginTop: 6 }} className="mono">
                {p.error}
              </div>
            )}
            {showReview && <Link href={`/models/${encodeURIComponent(id)}/approvals`}>{role === 'content_creator' ? t('calendar.reviewDrafts') : t('calendar.viewBundlesApprovals')}</Link>}
            {showTeamNotes && <PostTeamNotes key={`notes:${p.id}`} modelId={id} postId={p.id} canEdit={canEdit || role === 'content_creator'} />}
            {canEdit && p.state === 'pending' && !p.remoteId && <PostScheduleForm key={`${p.id}:${p.scheduledFor}`} postId={p.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}
