import Link from 'next/link';
import type { api } from '@/lib/api';

type Schedule = Awaited<ReturnType<typeof api.digests.list>>['schedule'];
export default function DigestScheduleStatus({ schedule, canConfigure }: { schedule: Schedule; canConfigure: boolean }) {
  const job = schedule?.latest;
  const state = !schedule ? 'Schedule status unavailable.' : !schedule.enabled ? 'Automatic digests are off.'
    : !job ? 'Attention: automatic digests are enabled, but no scheduled job was found.'
    : job.state === 'ready' ? 'Automatic digest queued.'
    : job.state === 'running' ? 'Automatic digest running.'
    : job.state === 'dead' ? 'Attention: the automatic digest failed. Future summaries may not be scheduled.'
    : job.state === 'done' ? 'Attention: the last automatic digest completed, but no later job was found.'
    : 'Attention: the automatic digest requires operator review.';
  return <section className="card stack" aria-label="Automatic digest schedule">
    <h2>Automatic schedule</h2><p>{state}</p>
    {schedule?.enabled && !schedule.workspacePermitted && <p role="alert">Workspace Safety permission is off. The worker cannot process these summaries.</p>}
    {schedule?.enabled && job && <p className="subtle">Eligible after {job.runAfter} · Attempts: {job.attempts}. A queued job is not proof that a worker is running. Refresh this page for current status.</p>}
    <p className="subtle">Summaries are stored here; this status does not confirm an external Relay message. The separate Safety switch or a scoped worker may also prevent execution.</p>
    {canConfigure && <Link href="/settings">Manage weekly digest settings</Link>}
  </section>;
}
