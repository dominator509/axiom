import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, LocaleCatalog } from '@axiom/core';

vi.mock('../api/auth', () => ({
  signIn: async () => ({ user: { id: 'u1', email: 'operator@example.test', role: 'owner' } }),
}));

vi.mock('../api/endpoints', () => ({
  getUiLocale: async () => ({
    locale: 'en',
    source: 'default',
    userLocale: null,
    orgLocale: null,
    supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'],
    canSetOrg: false,
  }),
}));

import LoginScreen, { LoginView } from './LoginScreen';

const catalog = new LocaleCatalog(CATALOGS);
const noop = () => undefined;

function renderView(locale: 'en' | 'es' | 'ja' | 'it' | 'pt-BR' | 'de' = 'en', overrides: Partial<React.ComponentProps<typeof LoginView>> = {}) {
  return renderToStaticMarkup(
    <LoginView
      locale={locale}
      email="operator@example.test"
      password="password123"
      busy={false}
      error={null}
      canSubmit
      onEmailChange={noop}
      onPasswordChange={noop}
      onSubmit={noop}
      {...overrides}
    />,
  );
}

it('mounts the default login screen with localized authentication copy', () => {
  const html = renderToStaticMarkup(<LoginScreen onAuthed={noop} />);
  expect(html).toContain(catalog.t('en', 'auth.welcomeBack'));
  expect(html).toContain(catalog.t('en', 'auth.signIn'));
});

it('renders the complete login surface in the selected Spanish locale', () => {
  const html = renderView('es');
  expect(html).toContain(catalog.t('es', 'auth.privateCreatorOs'));
  expect(html).toContain(catalog.t('es', 'auth.signInContinue'));
  expect(html).toContain(catalog.t('es', 'auth.email'));
  expect(html).toContain(catalog.t('es', 'auth.protected'));
  expect(html).not.toContain(catalog.t('en', 'auth.signInContinue'));
});

it('keeps Japanese labels and accessible controls localized', () => {
  const html = renderView('ja');
  expect(html).toContain(catalog.t('ja', 'auth.email'));
  expect(html).toContain(catalog.t('ja', 'auth.password'));
  expect(html).toContain(catalog.t('ja', 'auth.signIn'));
  expect(html).not.toContain(catalog.t('en', 'auth.password'));
});

it('surfaces localized failure and busy states without hiding the form boundary', () => {
  const errorHtml = renderView('de', { error: catalog.t('de', 'auth.signInFailed') });
  expect(errorHtml).toContain(catalog.t('de', 'auth.signInFailed'));
  const busyHtml = renderView('it', { busy: true, canSubmit: false });
  expect(busyHtml).toContain('role="progressbar"');
});
