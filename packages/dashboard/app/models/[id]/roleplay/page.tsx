import Link from 'next/link';
import { api, getSession } from '@/lib/api';
import RoleplayManager, { type RoleplayActorOption } from '@/components/RoleplayManager';
import { talentDestinationAllowed } from '@/lib/navigation-role';
import { getServerLocale } from '@/lib/server-locale';

export const dynamic = 'force-dynamic';

export default async function RoleplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getServerLocale();
  const session = await getSession();
  const role = session?.user?.role;
  if (!talentDestinationAllowed(role, 'roleplay'))
    return (
      <div className="card stack">
        <h2>{t('roleplay.contextUnavailable')}</h2>
        <p>{t('team.loadFailed')}</p>
        <Link href={`/models/${encodeURIComponent(id)}`} className="btn secondary">
          {t('model.backToTalent')}
        </Link>
      </div>
    );
  try {
    const operations = role === 'chatter' ? null : (await api.models.teamOperations(id)).data;
    const actorOptions: RoleplayActorOption[] =
      role === 'chatter'
        ? (await api.myShifts()).data
            .filter(
              (shift) => shift.modelId === id && shift.status === 'active' && session?.user?.id,
            )
            .map((shift) => ({
              actor: { type: 'human', ref: session!.user!.id } as const,
              label: `${t('team.humanChatter')} · ${t('team.humanActor', {
                ref: session?.user?.name ?? session?.user?.email ?? t('team.unknownActor'),
              })}`,
              shiftId: shift.id,
              queue: shift.queue,
            }))
        : (() => {
            if (!operations) return [];
            const members = new Map(operations.members.map((member) => [member.id, member.email]));
            return operations.shifts
              .filter((shift) => shift.status === 'active')
              .flatMap<RoleplayActorOption>((shift): RoleplayActorOption[] => {
                if (
                  shift.assigneeType === 'llm' &&
                  shift.assigneeAgentRef &&
                  operations.agentPermissions.some(
                    (permission) =>
                      permission.agentRef === shift.assigneeAgentRef && permission.canEdit,
                  )
                ) {
                  return [
                    {
                      actor: { type: 'llm', ref: shift.assigneeAgentRef } as const,
                      label: t('team.llmActor', { ref: shift.assigneeAgentRef }),
                      shiftId: shift.id,
                      queue: shift.queue,
                    },
                  ];
                }
                if (shift.assigneeType === 'human' && shift.assigneeUserId) {
                  return [
                    {
                      actor: { type: 'human', ref: shift.assigneeUserId } as const,
                      label: `${t('team.humanChatter')} · ${t('team.humanActor', {
                        ref: members.get(shift.assigneeUserId) ?? shift.assigneeUserId,
                      })}`,
                      shiftId: shift.id,
                      queue: shift.queue,
                    },
                  ];
                }
                return [];
              });
          })();
    const canEdit = ['owner', 'manager', 'operator', 'chatter'].includes(role ?? '');
    return <RoleplayManager modelId={id} actorOptions={actorOptions} canEdit={canEdit} />;
  } catch {
    const destination = role === 'chatter' ? '/shifts' : `/models/${encodeURIComponent(id)}/team`;
    const label = role === 'chatter' ? t('shifts.title') : t('team.pageTitle');
    return (
      <div className="card stack" role="alert">
        <h2>{t('roleplay.contextUnavailable')}</h2>
        <p>{t('team.loadFailed')}</p>
        <Link href={destination} className="btn secondary">
          {label}
        </Link>
      </div>
    );
  }
}
