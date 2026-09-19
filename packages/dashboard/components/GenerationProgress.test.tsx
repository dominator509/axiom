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
