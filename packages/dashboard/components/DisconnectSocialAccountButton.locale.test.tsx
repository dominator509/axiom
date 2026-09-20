import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import LocaleProvider from './LocaleProvider';
import DisconnectSocialAccountButton from './DisconnectSocialAccountButton';

it('renders disconnect controls from the persisted Spanish catalog', () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale="es">
      <DisconnectSocialAccountButton accountId="account" displayName="Grok (Luna)" />
    </LocaleProvider>,
  );
  expect(html).toContain('Desconectar');
  expect(html).not.toContain('Disconnect');
});
