import { readDashboardJson } from './response';

export type GenerationStatus = {
  assetReady: boolean;
  verdict: string;
  state: string;
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
      const { data } = await readDashboardJson<{ data?: {
        id?: unknown; modelId?: unknown; state?: unknown; assetId?: unknown;
        tosReport?: { verdict?: unknown; sanitization?: { assetId?: unknown; selected?: unknown; exactFileHashChanged?: unknown } } | null;
      } }>(response);
      if (data?.id !== bundleId || data.modelId !== modelId || typeof data.state !== 'string')
        throw new Error('Unexpected bundle');
      const verdict = data.tosReport?.verdict ?? 'pending';
      if (typeof verdict !== 'string' || !['pending', 'pass', 'review', 'block'].includes(verdict))
        throw new Error('Unexpected scan status');
      const assetReady = typeof data.assetId === 'string' && data.assetId.length > 0;
      if (stopped) return;
      const privacy = data.tosReport?.sanitization;
      const sanitization = assetReady && privacy && privacy.assetId === data.assetId && typeof privacy.selected === 'boolean'
        && typeof privacy.exactFileHashChanged === 'boolean' && (privacy.selected || !privacy.exactFileHashChanged)
        ? { selected: privacy.selected, exactFileHashChanged: privacy.exactFileHashChanged } : undefined;
      onStatus({ assetReady, verdict, state: data.state, ...(sanitization ? { sanitization } : {}) });
      if ((assetReady && verdict !== 'pending') || ['rejected', 'hold'].includes(data.state)) return;
    } catch {
      if (!stopped) onUnavailable();
      // Stop on unavailable status, including auth expiry. The user can reload
      // the review queue; do not hammer an expired session or infer job failure.
      return;
    } finally {
      clearTimeout(deadline);
    }
    if (!stopped && ++attempts < 120) next = setTimeout(() => void poll(), 5_000);
    else if (!stopped) onUnavailable();
  }
  void poll();
  return () => {
    stopped = true;
    clearTimeout(next);
    active?.abort();
  };
}
