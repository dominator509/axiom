import { api, getSession } from '@/lib/api';
import Link from 'next/link';
import PostScheduleForm from '@/components/PostScheduleForm';
import PostTeamNotes from '@/components/PostTeamNotes';
import PlaybookCadence, { currentUtcWeek } from '@/components/PlaybookCadence';
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
  const showTeamNotes = ['owner', 'manager', 'operator', 'analyst', 'agent'].includes(role ?? '');
  const canEdit = ['owner', 'manager', 'operator'].includes(session?.user?.role ?? '');
  const query = await searchParams;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const requestedMonth = query?.month;
  const validMonth = typeof requestedMonth === 'string' &&
    /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(requestedMonth);
  const invalidMonth = requestedMonth !== undefined && !validMonth;
  const month = validMonth ? requestedMonth : currentMonth;
  const [year, monthNumber] = month.split('-').map(Number);
  const from = new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString();
  const to = new Date(Date.UTC(year, monthNumber, 1) - 1).toISOString();
  const previous = new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
  const calendarPath = `/models/${encodeURIComponent(id)}/calendar`;
  const monthHref = (value: string) => `${calendarPath}?${new URLSearchParams({ month: value })}`;

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
  let cadenceUnavailable = false;
  if (showCadence) try {
    const [saved, scheduled] = await Promise.all([
      api.models.playbookGuidelines(id), api.models.calendar(id, week.from, week.to),
    ]);
    guidelines = saved.data;
    weekPosts = scheduled.data;
  } catch { cadenceUnavailable = true; }

  return (
    <div className="page-stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Content calendar</h2>
        <span style={{ color: 'var(--muted)' }}>{error ? 'Calendar unavailable' : `${posts.length} ${posts.length === 1 ? 'post' : 'posts'} in this month`}</span>
      </div>
      <nav className="row" aria-label="Calendar months">
        {year > 1000 || monthNumber > 1 ? <Link href={monthHref(previous)}>Previous month</Link> : null}
        <strong>{month} (UTC)</strong>
        {year < 9999 || monthNumber < 12 ? <Link href={monthHref(next)}>Next month</Link> : null}
        {month !== currentMonth && <Link href={calendarPath}>Current month</Link>}
      </nav>
      <form action={calendarPath} className="row">
        <label>Month (UTC) <input type="month" name="month" defaultValue={month} min="1000-01" max="9999-12" required /></label>
        <button className="btn secondary" type="submit">Show month</button>
      </form>
      {invalidMonth && <p role="alert">Invalid or repeated month parameter. Showing the current UTC month.</p>}
      {showCadence && <PlaybookCadence modelId={id} guidelines={guidelines} posts={weekPosts} {...week} unavailable={cadenceUnavailable} />}
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
      <div className="grid">
        {posts.map((p) => (
          <div key={p.id} className="card">
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
            {showTeamNotes && <PostTeamNotes key={`notes:${p.id}`} modelId={id} postId={p.id} canEdit={canEdit} />}
            {canEdit && p.state === 'pending' && !p.remoteId && <PostScheduleForm key={`${p.id}:${p.scheduledFor}`} postId={p.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}
