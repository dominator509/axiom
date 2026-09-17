import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { withOrgContext, writeAudit } from './routes/helpers.js';

// These are the human roles currently enabled by authentication. Scoped human
// roles will join this list only with the corresponding auth activation gate.
export const assignableMemberRoles = ['owner', 'manager', 'operator', 'analyst'] as const;
export type AssignableMemberRole = typeof assignableMemberRoles[number];

/** Atomic owner-controlled role change; no caller can alter tenant membership. */
export async function changeMemberRole(input: {
  orgId: string; actorUserId: string; userId: string;
  expectedRole: string; role: AssignableMemberRole;
}) {
  const { orgId, actorUserId, userId, expectedRole, role } = input;
  if (!assignableMemberRoles.includes(role)) return { outcome: 'unsupported' as const };
  return withOrgContext(orgId, async tx => {
    // Serialize owner-count checks and audit writes in the same lock order.
    await tx.execute(sql`SELECT id FROM org WHERE id = ${orgId} FOR UPDATE`);
    const [actor] = await tx.select().from(schema.authUser)
      .where(and(eq(schema.authUser.orgId, orgId), eq(schema.authUser.id, actorUserId))).limit(1);
    if (actor?.role !== 'owner') return { outcome: 'denied' as const };
    const [member] = await tx.select().from(schema.authUser)
      .where(and(eq(schema.authUser.orgId, orgId), eq(schema.authUser.id, userId))).limit(1);
    if (!member) return { outcome: 'missing' as const };
    if (member.role !== expectedRole) return { outcome: 'conflict' as const };
    if (member.role === role) return { outcome: 'unchanged' as const, userId, role };
    if (member.role === 'owner') {
      const owners = await tx.select({ id: schema.authUser.id }).from(schema.authUser)
        .where(and(eq(schema.authUser.orgId, orgId), eq(schema.authUser.role, 'owner'))).limit(2);
      if (owners.length < 2) return { outcome: 'last-owner' as const };
    }
    const [changed] = await tx.update(schema.authUser).set({ role, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(schema.authUser.orgId, orgId), eq(schema.authUser.id, userId), eq(schema.authUser.role, expectedRole))).returning({ id: schema.authUser.id });
    if (!changed) return { outcome: 'conflict' as const };
    // Existing sessions must not keep the former permissions after a downgrade.
    await tx.delete(schema.authSession).where(eq(schema.authSession.userId, userId));
    await writeAudit(tx, orgId, actorUserId, 'team.member.role', userId, { previousRole: expectedRole, role, sessionsRevoked: true });
    return { outcome: 'changed' as const, userId, role };
  });
}
