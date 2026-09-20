import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import ModelLifecycleControls from './ModelLifecycleControls';
import NetworkForm from './NetworkForm';
import ProfileEditor from './ProfileEditor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function render(locale: 'es' | 'de') {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <ProfileEditor model={{ id: 'model', displayName: 'Luna', handle: 'luna', bio: null }} />
      <ModelLifecycleControls
        model={{ id: 'model', displayName: 'Luna', isActive: true }}
        canEdit
      />
      <NetworkForm
        modelId="model"
        initial={{ egressMode: 'direct', proxyAddr: null, expectedEgressIp: null }}
      />
    </LocaleProvider>,
  );
}

it('renders the mounted profile, lifecycle and direct-network controls in Spanish', () => {
  const html = render('es');
  expect(html).toContain('Editar datos del perfil');
  expect(html).toContain('Ciclo de vida del perfil');
  expect(html).toContain('Modo de salida');
  expect(html).toContain('El modo directo usa la IP saliente');
  expect(html).not.toContain('Edit profile details');
  expect(html).not.toContain('Profile lifecycle');
  expect(html).not.toContain('Egress mode');
});

it('renders the mounted profile, lifecycle and network controls in German', () => {
  const html = render('de');
  expect(html).toContain('Profildetails bearbeiten');
  expect(html).toContain('Profil-Lebenszyklus');
  expect(html).toContain('Ausgangsmodus');
  expect(html).toContain('Der Direktmodus verwendet die Ausgangs-IP');
  expect(html).not.toContain('Edit profile details');
  expect(html).not.toContain('Profile lifecycle');
  expect(html).not.toContain('Egress mode');
});
