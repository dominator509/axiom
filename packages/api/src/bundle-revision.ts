import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { enqueueJob } from '@axiom/worker';

/** Called in the domain transaction while holding the bundle row lock. */
export async function queueBundleRevision(
  tx: Parameters<typeof enqueueJob>[0],
  orgId: string,
  bundleId: string,
  currentState: string,
  instructions: string,
  userId?: string,
) {
  const revisionId = randomUUID();
  const rows = await tx
    .update(schema.contentBundle)
    .set({
      state: 'revising',
      tosReport: { verdict: 'pending', revisionId },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.contentBundle.id, bundleId),
        eq(schema.contentBundle.orgId, orgId),
        eq(schema.contentBundle.state, currentState),
      ),
    )
    .returning();
  if (rows.length === 0) throw new Error('bundle changed while revision was being queued');
  await enqueueJob(tx, {
    orgId,
    queue: 'content',
    kind: 'content.generate',
    payload: { bundleId, revision: { id: revisionId, instructions, userId } },
    dedupeParts: ['content.generate', bundleId, revisionId],
  });
  return rows[0];
}
