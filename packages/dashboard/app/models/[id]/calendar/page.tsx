import { api, getSession } from '@/lib/api';
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
  const role = session?.user?.role;
  if (!talentDestinationAllowed(role, 'calendar')) return <div className="card"><h2>Calendar access unavailable</h2><p>Your role does not include this calendar.</p><Link href="/">Back to workspace</Link></div>;
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

  return (
    <div className="page-stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Content calendar</h2>
        <span style={{ color: 'var(--muted)' }}>{error ? 'Calendar unavailable' : `${posts.length} ${posts.length === 1 ? 'post' : 'posts'} in this ${view}`}</span>
      </div>
      <nav className="row" aria-label="Calendar navigation">
        {view === 'month' ? <>
          {year > 1000 || monthNumber > 1 ? <Link href={monthHref(previous)}>Previous month</Link> : null}
          <strong>{month} (UTC)</strong>
          {year < 9999 || monthNumber < 12 ? <Link href={monthHref(next)}>Next month</Link> : null}
          {month !== currentMonth && <Link href={calendarPath}>Current month</Link>}
        </> : <>
          <Link href={weekHref(previousWeek)}>Previous week</Link>
          <strong>Week of {weekStart} (UTC)</strong>
          <Link href={weekHref(nextWeek)}>Next week</Link>
          <Link href={weekHref(now.toISOString().slice(0, 10))}>Current week</Link>
        </>}
        <Link href={monthViewHref}>Month view</Link>
        <Link href={weekHref(weekStart)}>Week view</Link>
      </nav>
      {view === 'month' && <form action={calendarPath} className="row">
        <label>Month (UTC) <input type="month" name="month" defaultValue={month} min="1000-01" max="9999-12" required /></label>
        <button className="btn secondary" type="submit">Show month</button>
      </form>}
      {invalidMonth && <p role="alert">Invalid or repeated month parameter. Showing the current UTC month.</p>}
      {invalidWeek && <p role="alert">Invalid week parameter. Showing the current UTC week.</p>}
      {invalidView && <p role="alert">Unknown calendar view. Showing the month view.</p>}
      {showCadence && <PlaybookCadence modelId={id} guidelines={guidelines} posts={weekPosts} {...week} unavailable={cadenceUnavailable} />}
      {showCadence && <CalendarOptimalTimes modelId={id} patterns={viralPatterns} />}
      {role === 'content_creator' && <p>To propose a posting time, stage a saved asset from the <Link href={`/models/${encodeURIComponent(id)}/media`}>media library</Link> with a schedule request. An operator must approve it before publication.</p>}
      {error && (
        <div className="card" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      )}
      {posts.length === 0 && !error && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            No scheduled posts in the window.{canEdit ? ' Approve a generated bundle to schedule.' : ' Approved posting plans will appear here.'}
          </p>
        </div>
      )}
      <CalendarBoard posts={posts} year={year} month={monthNumber} view={view} weekStart={weekStart} canEdit={canEdit} />
      <h3>Post details</h3>
      <div className="grid">
        {posts.map((p) => (
          <div key={p.id} id={`post-${p.id}`} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="mono">{p.platform}</span>
              <span
                className={`badge ${p.state === 'published' ? 'good' : p.state === 'failed' ? 'bad' : 'mute'}`}
              >
                {p.state}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              {p.scheduledFor ? `${new Date(p.scheduledFor).toISOString()} (UTC)` : 'not scheduled'}
            </div>
            {p.error && (
              <div style={{ color: 'var(--bad)', marginTop: 6 }} className="mono">
                {p.error}
              </div>
            )}
            {showReview && <Link href={`/models/${encodeURIComponent(id)}/approvals`}>{role === 'content_creator' ? 'Review drafts' : 'View bundles and approvals'}</Link>}
            {showTeamNotes && <PostTeamNotes key={`notes:${p.id}`} modelId={id} postId={p.id} canEdit={canEdit || role === 'content_creator'} />}
            {canEdit && p.state === 'pending' && !p.remoteId && <PostScheduleForm key={`${p.id}:${p.scheduledFor}`} postId={p.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}
