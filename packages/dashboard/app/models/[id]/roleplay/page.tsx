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
    const operations = (await api.models.teamOperations(id)).data;
    const members = new Map(operations.members.map(member => [member.id, member.email]));
    const actorOptions: RoleplayActorOption[] = operations.shifts.filter(shift => shift.status === 'active').flatMap<RoleplayActorOption>((shift): RoleplayActorOption[] => {
      if (shift.assigneeType === 'llm' && shift.assigneeAgentRef && operations.agentPermissions.some(permission => permission.agentRef === shift.assigneeAgentRef && permission.canEdit)) {
        return [{ actor: { type: 'llm', ref: shift.assigneeAgentRef } as const, label: `LLM · ${shift.assigneeAgentRef}`, shiftId: shift.id, queue: shift.queue }];
      }
      if (shift.assigneeType === 'human' && shift.assigneeUserId && (role !== 'chatter' || shift.assigneeUserId === session?.user?.id)) {
        return [{ actor: { type: 'human', ref: shift.assigneeUserId } as const, label: `Human · ${members.get(shift.assigneeUserId) ?? shift.assigneeUserId}`, shiftId: shift.id, queue: shift.queue }];
      }
      return [];
    }).filter((option, index, all) => all.findIndex(other => `${other.actor.type}:${other.actor.ref}` === `${option.actor.type}:${option.actor.ref}`) === index);
    const canEdit = ['owner', 'manager', 'operator', 'chatter'].includes(role ?? '');
    return <RoleplayManager modelId={id} actorOptions={actorOptions} canEdit={canEdit} />;
  } catch {
    return <div className="card stack" role="alert"><h2>Roleplay unavailable</h2><p>There is no confirmed active human or approved LLM shift for this model. Create one from Team &amp; shifts, then return here.</p><Link href={`/models/${encodeURIComponent(id)}/team`} className="btn secondary">Open Team &amp; shifts</Link></div>;
  }
}
