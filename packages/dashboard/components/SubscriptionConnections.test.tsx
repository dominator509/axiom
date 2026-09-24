import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocaleProvider from './LocaleProvider';
import SubscriptionConnections from './SubscriptionConnections';

it('renders both non-Grok subscription lifecycle controls with localized labels', () => {
  const html = renderToStaticMarkup(<LocaleProvider initialLocale="es"><SubscriptionConnections /></LocaleProvider>);
  expect(html).toContain('Conexiones de proveedores de IA');
  expect(html).toContain('OpenAI');
  expect(html).toContain('Anthropic');
  expect(html).toContain('Conectar');
  expect(html).toContain('Comprobando');
  expect(html).not.toContain('accessKey');
  expect(html).not.toContain('secret');
});
