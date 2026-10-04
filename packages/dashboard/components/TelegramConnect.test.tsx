import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS, SUPPORTED_LOCALES } from '@axiom/core';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import LocaleProvider from './LocaleProvider';
import TelegramConnect, { telegramConnectErrorKey } from './TelegramConnect';

it.each(SUPPORTED_LOCALES)('shows the destination instructions in %s', (locale) => {
  const html = renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <TelegramConnect modelId="model-1" />
    </LocaleProvider>,
  );

  expect(html).toContain(CATALOGS[locale]['network.telegramTargetHint']);
});

it.each([
  ['TELEGRAM_BOT_TOKEN_INVALID', 'network.telegramBotTokenInvalid'],
  ['TELEGRAM_EGRESS_UNAVAILABLE', 'network.telegramEgressUnavailable'],
  ['TELEGRAM_PROVIDER_UNAVAILABLE', 'network.telegramProviderUnavailable'],
  ['TELEGRAM_TARGET_IS_BOT', 'network.telegramTargetIsBot'],
  ['TELEGRAM_TARGET_INVALID', 'network.telegramDestinationInvalid'],
  ['TELEGRAM_TARGET_NOT_CHANNEL', 'network.telegramDestinationInvalid'],
  ['TELEGRAM_BOT_CANNOT_POST', 'network.telegramPostingPermission'],
  [undefined, 'network.telegramConnectFailed'],
] as const)('maps safe API code %s to a translated message key', (code, key) => {
  expect(telegramConnectErrorKey(code)).toBe(key);
});
