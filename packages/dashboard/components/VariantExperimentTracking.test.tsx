import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import VariantExperimentTracking from './VariantExperimentTracking';
it.each(['draft', 'completed'])('shows history without allocating or recording for %s', status => {
  const html = renderToStaticMarkup(<VariantExperimentTracking modelId="model" experimentId="experiment" status={status} canEdit />);
  expect(html).toContain('Refresh assignments');
  expect(html).not.toContain('Allocate variant');
  expect(html).not.toContain('Save observed outcome');
});
it('exposes allocation and explicitly observed outcome controls for running experiments', () => {
  const html = renderToStaticMarkup(<VariantExperimentTracking modelId="model" experimentId="experiment" status="running" canEdit />);
  expect(html).toContain('Allocate variant'); expect(html).toContain('Save observed outcome');
  expect(html).toContain('not automatically verified provider analytics');
  expect(html).toContain('Choose result');
});
it('allows measuring existing assignments while paused without allocating new ones', () => {
  const html = renderToStaticMarkup(<VariantExperimentTracking modelId="model" experimentId="experiment" status="paused" canEdit />);
  expect(html).not.toContain('Allocate variant'); expect(html).toContain('Save observed outcome');
});
it('withholds all mutation controls from read-only users', () => {
  const html = renderToStaticMarkup(<VariantExperimentTracking modelId="model" experimentId="experiment" status="running" canEdit={false} />);
  expect(html).not.toContain('<fieldset'); expect(html).toContain('Refresh assignments');
});
