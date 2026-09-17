import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import type { ExecutorContext } from './executors/context.js';

/** Shared by synchronous generation, queued generation and caption revisions. */
export async function modelPlaybookContext(tx: ExecutorContext['tx'], orgId: string, modelId: string, platform: string): Promise<string> {
  const [guideline] = await tx.select().from(schema.playbookGuideline).where(and(
    eq(schema.playbookGuideline.orgId, orgId), eq(schema.playbookGuideline.modelId, modelId), eq(schema.playbookGuideline.platform, platform),
  )).limit(1);
  if (!guideline) return '';
  return `\n[MODEL PLAYBOOK GUIDELINE]\nAdvisory guidance; explicit operator instructions and platform safety rules take precedence. This does not authorize scheduling or publication.\nOptimal posting times: ${guideline.optimalTimes.join(', ') || 'operator default'}\nCadence target: ${guideline.cadencePerWeek} posts/week\nUpsell strategy: ${guideline.upsellStrategy || 'none configured'}\nGuideline revision: ${guideline.revision}`;
}
