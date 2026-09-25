import { readDashboardJson } from './response';

export type GenerationStatus = {
  assetReady: boolean;
  verdict: string;
  state: string;
  generationPaused?: boolean;
  generationJob?: { state: 'ready' | 'running' | 'done' | 'dead' | 'failed' | 'cancelled'; attempts: number; maxAttempts: number; ageSeconds: number } | null;
  scanFailed?: boolean;
  sanitization?: { selected: boolean; exactFileHashChanged: boolean };
};

/** Read-only polling: never redispatch generation on a failed or lost response. */
export function watchGeneration(
  bundleId: string,
  modelId: string,
  onStatus: (status: GenerationStatus) => void,
  onUnavailable: () => void,
): () => void {
  let stopped = false;
  let attempts = 0;
  let next: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;
  async function poll() {
    const controller = new AbortController();
    active = controller;
    const deadline = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`/api/v1/bundles/${encodeURIComponent(bundleId)}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Status unavailable');
      const { data, generationPaused, generationJob, scanFailed } = await readDashboardJson<{ generationPaused?: unknown; generationJob?: unknown; scanFailed?: unknown; data?: {
        id?: unknown; modelId?: unknown; state?: unknown; assetId?: unknown;
        tosReport?: { verdict?: unknown; sanitization?: { assetId?: unknown; selected?: unknown; exactFileHashChanged?: unknown } } | null;
      } }>(response);
      if (data?.id !== bundleId || data.modelId !== modelId || typeof data.state !== 'string')
        throw new Error('Unexpected bundle');
      if (generationPaused !== undefined && typeof generationPaused !== 'boolean')
        throw new Error('Unexpected generation pause status');
      if (scanFailed !== undefined && typeof scanFailed !== 'boolean')
        throw new Error('Unexpected scan failure status');
      const awaitingGeneratedMedia = !data.assetId && ['generated', 'hold'].includes(data.state);
      if (awaitingGeneratedMedia && generationJob === undefined)
        throw new Error('Generation job status is missing');
      const validJobStates = ['ready', 'running', 'done', 'dead', 'failed', 'cancelled'];
      let safeGenerationJob: GenerationStatus['generationJob'];
      if (generationJob !== undefined && generationJob !== null) {
        if (typeof generationJob !== 'object') throw new Error('Unexpected generation job status');
        const job = generationJob as Record<string, unknown>;
        if (typeof job.state !== 'string' || !validJobStates.includes(job.state)
          || !Number.isInteger(job.attempts) || (job.attempts as number) < 0
          || !Number.isInteger(job.maxAttempts) || (job.maxAttempts as number) < 0
          || !Number.isInteger(job.ageSeconds) || (job.ageSeconds as number) < 0)
          throw new Error('Unexpected generation job status');
        safeGenerationJob = {
          state: job.state as NonNullable<GenerationStatus['generationJob']>['state'],
          attempts: job.attempts as number,
          maxAttempts: job.maxAttempts as number,
          ageSeconds: job.ageSeconds as number,
        };
      } else if (generationJob === null) {
        safeGenerationJob = null;
      }
      const verdict = data.tosReport?.verdict ?? 'pending';
      if (typeof verdict !== 'string' || !['pending', 'pass', 'review', 'block'].includes(verdict))
        throw new Error('Unexpected scan status');
      const assetReady = typeof data.assetId === 'string' && data.assetId.length > 0;
      if (scanFailed && (!assetReady || verdict !== 'pending')) throw new Error('Contradictory scan failure status');
      if (stopped) return;
      const privacy = data.tosReport?.sanitization;
      const sanitization = assetReady && privacy && privacy.assetId === data.assetId && typeof privacy.selected === 'boolean'
        && typeof privacy.exactFileHashChanged === 'boolean' && (privacy.selected || !privacy.exactFileHashChanged)
        ? { selected: privacy.selected, exactFileHashChanged: privacy.exactFileHashChanged } : undefined;
      onStatus({ assetReady, verdict, state: data.state,
        ...(typeof generationPaused === 'boolean' ? { generationPaused } : {}),
        ...(generationJob !== undefined ? { generationJob: safeGenerationJob } : {}),
        ...(typeof scanFailed === 'boolean' ? { scanFailed } : {}),
        ...(sanitization ? { sanitization } : {}) });
      const terminalMediaJob = safeGenerationJob === null || (safeGenerationJob && ['done', 'dead', 'failed', 'cancelled'].includes(safeGenerationJob.state));
      if (scanFailed || (assetReady && verdict !== 'pending') || ['rejected', 'hold'].includes(data.state) || terminalMediaJob) return;
    } catch {
      if (!stopped) onUnavailable();
      // Stop on unavailable status, including auth expiry. The user can reload
      // the review queue; do not hammer an expired session or infer job failure.
      return;
    } finally {
      clearTimeout(deadline);
    }
    // Bound browser polling, but retain the last verified queue state. A job
    // that remains ready is still confirmed as queued, not "unavailable".
    if (!stopped && ++attempts < 120) next = setTimeout(() => void poll(), 5_000);
  }
  void poll();
  return () => {
    stopped = true;
    clearTimeout(next);
    active?.abort();
  };
}
