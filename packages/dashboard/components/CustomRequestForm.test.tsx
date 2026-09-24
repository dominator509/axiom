import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CustomRequestForm, { requestPayload } from './CustomRequestForm';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function data(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}
it('creates scoped requests without inventing a charge or fan', () => {
  expect(requestPayload(data({ title: ' Portrait ', priceUsd: '0' }), 'model')).toEqual({ modelId: 'model', title: 'Portrait', priceUsd: 0 });
});
it.each(['pending', 'filming', 'editing', 'delivered'])('supports backend status %s', status => {
  expect(requestPayload(data({ status }))).toEqual({ status });
});
it('rejects invalid status and invalid creation fields', () => {
  expect(() => requestPayload(data({ status: 'published' }))).toThrow();
  expect(() => requestPayload(data({ title: ' ' }), 'model')).toThrow();
  expect(() => requestPayload(data({ title: 'Portrait', priceUsd: '-1' }), 'model')).toThrow();
});
it('renders labeled creation and existing-ticket controls', () => {
  expect(renderToStaticMarkup(<CustomRequestForm modelId="model" fans={[]} />)).toContain('Create custom request');
  const html = renderToStaticMarkup(<CustomRequestForm requestId="ticket" title="Portrait" status="editing" />);
  expect(html).toContain('Update status for Portrait');
  expect(html).toContain('value="editing" selected=""');
});
