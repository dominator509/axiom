import type { ContentBundle } from '@/lib/api';

export default function RequestedSchedule({ intent }: { intent: ContentBundle['publishIntent'] }) {
  if (!intent) return null;
  if (intent.action !== 'schedule') return <p className="subtle">Immediate publication was requested. Approval is still required.</p>;
  const timestamp = intent.scheduledAt ? Date.parse(intent.scheduledAt) : NaN;
  if (!Number.isFinite(timestamp)) return <p role="alert">The saved schedule request is invalid. Choose an explicit valid time before approving.</p>;
  return <div className="card stack"><strong>Requested schedule for {intent.platform}</strong>
    <p><time dateTime={new Date(timestamp).toISOString()}>{new Date(timestamp).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</time></p>
    <p className="subtle">This is not approved or queued for publishing. Leaving the approval slot blank uses this request; an explicit approval slot overrides it.</p>
  </div>;
}
