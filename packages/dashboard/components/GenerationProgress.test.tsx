import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ calls: 0, scanFailed: true }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: () => {},
  useState: (initial: unknown) => [state.calls++ === 1
    ? { assetReady: true, verdict: 'pending', state: 'generated', scanFailed: state.scanFailed }
    : initial, vi.fn()],
}));
vi.mock('./BundleMedia', () => ({ default: () => 'Saved-media-preview' }));
vi.mock('./GenerationRetry', () => ({ default: () => 'Generation-retry-control' }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string) => ({
      'generation.statusUnavailable': 'Live status unavailable. Generation may still be running.',
      'generation.openApprovals': 'Open Approvals',
      'generation.openIncidents': 'Open Incidents',
      'generation.openReviewDrafts': 'Open Review drafts',
      'generation.scanFailedContact': 'Contact an operator for details; do not generate again just to retry the scan.',
      'generation.scanFailed': 'ToS scanning failed. Your generated media is saved, but approval remains blocked.',
      'generation.scanFailedOperator': 'Open Incidents for details; do not generate again just to retry the scan.',
      'generation.onHold': 'Bundle is on hold.',
      'generation.onHoldOperator': 'Inspect Incidents before retrying generation.',
      'generation.onHoldContact': 'Contact an operator before retrying generation.',
      'generation.rejected': 'Bundle was rejected.',
      'generation.paused': 'Media generation is paused by the workspace kill switch.',
      'generation.queued': 'Grok generation queued or running. No generated asset is attached yet.',
      'generation.scanPending': 'Generated media is attached. ToS scanning is pending; approval is not available yet.',
      'generation.scanPassed': 'Generated media is attached and ToS scanning passed. Review the bundle before approval.',
      'generation.requiresReviewOperator': 'Generated media is attached but requires review. Open Approvals to inspect the scan.',
      'generation.requiresReviewDraft': 'Generated media is attached but requires review. Open Review drafts to inspect the scan.',
      'generation.blocked': 'Generated media is attached but blocked by ToS. It cannot be approved.',
      'generation.sanitizationComplete': 'Embedded metadata sanitization completed. Exact-file SHA-256 {hashState}.',
      'generation.sanitizationHashChanged': 'changed',
      'generation.sanitizationHashUnchanged': 'unchanged',
      'generation.sanitizationWarning': 'This does not prevent perceptual matching.',
    }[key] ?? key),
  }),
}));
import GenerationProgress from './GenerationProgress';
beforeEach(() => { state.calls = 0; state.scanFailed = true; });
describe('scan failure feedback', () => {
  it('directs creators to drafts and an operator without inaccessible incident links', () => {
    const html = renderToStaticMarkup(<GenerationProgress bundleId="bundle" modelId="model" operatorControls={false} />);
    expect(html).toContain('Contact an operator for details');
    expect(html).toContain('Open Review drafts');
    expect(html).toContain('Saved-media-preview');
    expect(html).not.toContain('href="/incidents"');
    expect(html).not.toContain('Generation-retry-control');
  });
  it('preserves preview and directs to incidents without offering regeneration', () => {
    const html = renderToStaticMarkup(<GenerationProgress bundleId="bundle" modelId="model" />);
    expect(html).toContain('ToS scanning failed');
    expect(html).toContain('approval remains blocked');
    expect(html).toContain('Saved-media-preview');
    expect(html).toContain('href="/incidents"');
    expect(html).not.toContain('Generation-retry-control');
  });
  it('keeps a genuinely pending scan distinct from failure', () => {
    state.scanFailed = false;
    const html = renderToStaticMarkup(<GenerationProgress bundleId="bundle" modelId="model" />);
    expect(html).toContain('ToS scanning is pending');
    expect(html).not.toContain('ToS scanning failed');
  });
});
