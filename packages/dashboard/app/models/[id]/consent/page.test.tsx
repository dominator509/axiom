import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ role: 'operator', records: vi.fn() }));
vi.mock('@/lib/api', () => ({ getSession: async () => ({ user: { role: state.role } }), api: { models: { consentRecords: state.records } } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import ConsentPage from './page';
beforeEach(() => { state.role = 'operator'; state.records.mockReset().mockResolvedValue({ data: [{ id: 'record', platform: 'fanvue', docKind: 'model_release', subjectRef: 'model', blobRef: 'opaque', sha256: 'a'.repeat(64), validFrom: '2026-01-01', validTo: null, granted: true }] }); });
it('renders a role-aware metadata vault without document contents', async () => {
  const html = renderToStaticMarkup(await ConsentPage({ params: Promise.resolve({ id: 'model' }) }));
  expect(html).toContain('Consent vault'); expect(html).toContain('Save consent metadata'); expect(html).toContain('Revoke record'); expect(html).not.toContain('opaque');
  state.role = 'viewer';
  expect(renderToStaticMarkup(await ConsentPage({ params: Promise.resolve({ id: 'model' }) }))).not.toContain('Save consent metadata');
});
