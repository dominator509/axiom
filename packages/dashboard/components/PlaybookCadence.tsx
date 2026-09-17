import Link from 'next/link';
import type { PlaybookGuideline, PostTarget } from '@/lib/api';

export function currentUtcWeek(now: Date) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  from.setUTCDate(from.getUTCDate() - (from.getUTCDay() + 6) % 7);
  return { from: from.toISOString(), to: new Date(from.getTime() + 7 * 86_400_000 - 1).toISOString() };
}

export function cadenceCounts(posts: PostTarget[], platform: string, from: string, to: string) {
  const seen = new Set<string>();
  let scheduled = 0, published = 0;
  for (const post of posts) {
    const time = Date.parse(post.scheduledFor ?? '');
    if (post.platform !== platform || !Number.isFinite(time) || time < Date.parse(from) || time > Date.parse(to) || seen.has(post.id)) continue;
    seen.add(post.id);
    if (post.state === 'published') published++;
    else if (post.state === 'pending' && !post.remoteId) scheduled++;
  }
  return { scheduled, published };
}

export default function PlaybookCadence({ modelId, guidelines, posts, from, to, unavailable }: {
  modelId: string; guidelines: PlaybookGuideline[]; posts: PostTarget[]; from: string; to: string; unavailable: boolean;
}) {
  return <section className="card stack" aria-label="Weekly playbook cadence">
    <h3>Weekly playbook cadence</h3>
    <p>Current week: {from.slice(0, 10)} through {to.slice(0, 10)} (UTC, Monday–Sunday).</p>
    <p className="subtle">Advisory only. Pending posts may not publish. Failed, canceled and uncertain posts do not count toward the plan. No schedule is changed automatically.</p>
    {unavailable || !Array.isArray(guidelines) || !Array.isArray(posts) || guidelines.some(item => !item || !Number.isSafeInteger(item.cadencePerWeek) || item.cadencePerWeek < 0 || !Array.isArray(item.optimalTimes)) ? <p role="alert">Cadence guidance is unavailable. No adherence conclusion can be drawn.</p>
      : guidelines.length === 0 ? <p>No cadence guidelines saved for this talent.</p>
      : guidelines.map(guideline => {
        const { scheduled, published } = cadenceCounts(posts, guideline.platform, from, to);
        const deficit = Math.max(0, guideline.cadencePerWeek - scheduled - published);
        return <div className="stack" key={guideline.id}>
          <strong>{guideline.platform} · revision {guideline.revision}</strong>
          <p>{published} published + {scheduled} pending / {guideline.cadencePerWeek} posts per week.</p>
          <p className={deficit ? 'badge warn' : 'subtle'}>{guideline.cadencePerWeek === 0 ? 'No weekly minimum configured.' : deficit ? `Under planned cadence by ${deficit} ${deficit === 1 ? 'post' : 'posts'}.` : 'Planned cadence covered; this is not a publication guarantee.'}</p>
          {guideline.optimalTimes.length > 0 && <p>Saved posting-time guidance: {guideline.optimalTimes.join(', ')}. Confirm the intended timezone before scheduling.</p>}
        </div>;
      })}
    <Link href={`/models/${encodeURIComponent(modelId)}/playbook`}>Review playbook guidelines</Link>
  </section>;
}
