import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import LocaleProvider from './LocaleProvider';
import OrgSettingsForm from './OrgSettingsForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const initial = { viralSharing: false, publishingEnabled: false, weeklyDigestEnabled: true };

it('renders the workspace controls through the shared catalog', () => {
  const html = renderToStaticMarkup(<OrgSettingsForm initial={initial} />);
  expect(html).toContain('Workspace settings');
  expect(html).toContain('Enable viral-sharing analysis');
  expect(html).toContain('Allow publishing workers to operate');
});

it('renders translated controls without changing their persisted values', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><OrgSettingsForm initial={initial} /></LocaleProvider>);
  expect(html).toContain('Configuración del espacio de trabajo');
  expect(html).toContain('Generar resúmenes semanales del espacio de trabajo');
  expect(html).toContain('checked=""');
});
