import Link from 'next/link';
import { api, getSession } from '@/lib/api';
import RoleplayManager, { type RoleplayActorOption } from '@/components/RoleplayManager';
import { talentDestinationAllowed } from '@/lib/navigation-role';

export const dynamic = 'force-dynamic';

export default async function RoleplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const role = session?.user?.role;
  if (!talentDestinationAllowed(role, 'roleplay')) return <div className="card stack"><h2>Roleplay access unavailable</h2><p>This workspace role cannot open the Chatter roleplay surface.</p><Link href={`/models/${encodeURIComponent(id)}`} className="btn secondary">Back to profile</Link></div>;
  try {
    const operations = role === 'chatter' ? null : (await api.models.teamOperations(id)).data;
    const actorOptions: RoleplayActorOption[] = role === 'chatter'
      ? (await api.myShifts()).data
        .filter(shift => shift.modelId === id && shift.status === 'active' && session?.user?.id)
        .map(shift => ({
          actor: { type: 'human', ref: session!.user!.id } as const,
          label: `Human · ${session?.user?.email ?? 'assigned chatter'}`,
          shiftId: shift.id,
          queue: shift.queue,
        }))
      : (() => {
        if (!operations) return [];
        const members = new Map(operations.members.map(member => [member.id, member.email]));
        return operations.shifts.filter(shift => shift.status === 'active').flatMap<RoleplayActorOption>((shift): RoleplayActorOption[] => {
          if (shift.assigneeType === 'llm' && shift.assigneeAgentRef && operations.agentPermissions.some(permission => permission.agentRef === shift.assigneeAgentRef && permission.canEdit)) {
            return [{ actor: { type: 'llm', ref: shift.assigneeAgentRef } as const, label: `LLM · ${shift.assigneeAgentRef}`, shiftId: shift.id, queue: shift.queue }];
          }
          if (shift.assigneeType === 'human' && shift.assigneeUserId) {
            return [{ actor: { type: 'human', ref: shift.assigneeUserId } as const, label: `Human · ${members.get(shift.assigneeUserId) ?? shift.assigneeUserId}`, shiftId: shift.id, queue: shift.queue }];
          }
          return [];
        });
      })();
    const canEdit = ['owner', 'manager', 'operator', 'chatter'].includes(role ?? '');
    return <RoleplayManager modelId={id} actorOptions={actorOptions} canEdit={canEdit} />;
  } catch {
    const destination = role === 'chatter' ? '/shifts' : `/models/${encodeURIComponent(id)}/team`;
    const label = role === 'chatter' ? 'Open My shifts' : 'Open Team & shifts';
    return <div className="card stack" role="alert"><h2>Roleplay unavailable</h2><p>There is no confirmed active human or approved LLM shift for this model. Create one from Team &amp; shifts, then return here.</p><Link href={destination} className="btn secondary">{label}</Link></div>;
  }
}
