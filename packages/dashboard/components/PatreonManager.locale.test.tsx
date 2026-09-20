import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import PatreonManager from './PatreonManager';

function render(locale: 'es' | 'de') {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <PatreonManager connectionId="connection-1" />
    </LocaleProvider>,
  );
}

it('localizes the Patreon loading state in Spanish', () => {
  const html = render('es');
  expect(html).toContain('Cargando la integración de Patreon');
  expect(html).not.toContain('Loading Patreon integration');
});

it('localizes the Patreon loading state in German', () => {
  const html = render('de');
  expect(html).toContain('Patreon-Integration wird geladen');
  expect(html).not.toContain('Loading Patreon integration');
});
