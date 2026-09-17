import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';

/**
 * Check the durable command ledger before applying a provider button action.
 * The in-memory command nonce cache protects a single API process; this
 * ledger check preserves one-use semantics across restarts and instances.
 */
export async function relayCommandAlreadyRecorded(
  tx: any,
  orgId: string,
  cardId: string,
  action: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: schema.relayCommand.id })
    .from(schema.relayCommand)
    .where(
      and(
        eq(schema.relayCommand.orgId, orgId),
        eq(schema.relayCommand.cardId, cardId),
        eq(schema.relayCommand.action, action),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
