import { and, eq } from 'drizzle-orm';
import { schema } from '@axiom/db';
import { readBoundedResponseText } from '@axiom/core';
import type { Executor } from './context.js';

const MAX_RESULT_BYTES = 512 * 1024;

export async function readScrapeResult(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`scraper returned HTTP ${response.status}`);
  }
  const raw = await readBoundedResponseText(response, MAX_RESULT_BYTES, 'scraper response', 30_000);
  let result: unknown;
  try { result = JSON.parse(raw); }
  catch { throw new Error('scraper returned invalid JSON'); }
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length === 0) {
    throw new Error('scraper returned an empty or invalid result');
  }
  return result as Record<string, unknown>;
}

function scraperOrigin(): string {
  return (process.env.SCRAPER_URL ?? 'http://127.0.0.1:8102').replace(/\/$/, '');
}

export const scrapeRun: Executor = async ({ tx, job }) => {
  const runId = typeof job.payload?.runId === 'string' ? job.payload.runId : '';
  if (!runId) throw new Error('scrape.run: payload.runId required');
  const [run] = await tx.select().from(schema.scrapeRun).where(and(eq(schema.scrapeRun.id, runId), eq(schema.scrapeRun.orgId, job.org_id))).limit(1);
  if (!run) throw new Error(`scrape.run: run ${runId} not found`);
  if (run.state === 'completed') return;
  await tx.update(schema.scrapeRun).set({ state: 'running', startedAt: new Date(), error: null }).where(eq(schema.scrapeRun.id, run.id));
  const token = process.env.AXIOM_SCRAPER_AUTH_TOKEN?.trim();
  if (!token) throw new Error('scrape.run: AXIOM_SCRAPER_AUTH_TOKEN is not configured');
  const path = run.kind === 'social' ? '/scrape/social' : '/scrape/competitor';
  const request = run.kind === 'social'
    ? { platform: run.request.platform, profile_url: run.request.profileUrl }
    : { brand_name: run.request.brandName, industry: run.request.industry, platforms: run.request.platforms };
  try {
    const response = await fetch(`${scraperOrigin()}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(30_000) });
    const result = await readScrapeResult(response);
    await tx.update(schema.scrapeRun).set({ state: 'completed', result, completedAt: new Date(), error: null }).where(eq(schema.scrapeRun.id, run.id));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'scraper request failed';
    await tx.update(schema.scrapeRun).set({ state: 'failed', error: message, completedAt: new Date() }).where(eq(schema.scrapeRun.id, run.id));
    throw error;
  }
};
