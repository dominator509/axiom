import { describe, expect, it } from 'vitest';
import { validateProductionRelayConfig } from './production-config.js';

const production = (): NodeJS.ProcessEnv => ({ NODE_ENV: 'production' });

describe('production relay configuration', () => {
  it('allows an entirely disabled optional integration', () => {
    expect(() => validateProductionRelayConfig(production())).not.toThrow();
  });

  it('rejects partially configured integrations', () => {
    expect(() =>
      validateProductionRelayConfig({ ...production(), DISCORD_BOT_TOKEN: 'bot-token' }),
    ).toThrow('Discord integration configuration is incomplete');
    expect(() =>
      validateProductionRelayConfig({ ...production(), THREADS_CLIENT_ID: 'client-id' }),
    ).toThrow('Threads integration configuration is incomplete');
    expect(() =>
      validateProductionRelayConfig({ ...production(), BLUEBUBBLES_URL: 'https://bluebubbles' }),
    ).toThrow('BlueBubbles integration configuration is incomplete');
    expect(() =>
      validateProductionRelayConfig({
        ...production(),
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram',
      }),
    ).toThrow('Telegram webhook configuration requires TELEGRAM_BOT_TOKEN');
    expect(() =>
      validateProductionRelayConfig({
        ...production(),
        TELEGRAM_BOT_TOKEN: 'bot-token',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram',
      }),
    ).toThrow('Telegram webhook configuration requires TELEGRAM_WEBHOOK_SECRET');
    expect(() =>
      validateProductionRelayConfig({
        ...production(),
        TELEGRAM_BOT_TOKEN: 'bot-token',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram',
        TELEGRAM_WEBHOOK_SECRET: 'too-short',
      }),
    ).toThrow('TELEGRAM_WEBHOOK_SECRET must contain 32-256');
    expect(() =>
      validateProductionRelayConfig({
        ...production(),
        TELEGRAM_WEBHOOK_URL: 'http://example.test/telegram',
      }),
    ).toThrow('TELEGRAM_WEBHOOK_URL must be a valid HTTPS URL in production');
    expect(() =>
      validateProductionRelayConfig({
        ...production(),
        TELEGRAM_WEBHOOK_URL: 'not-a-url',
      }),
    ).toThrow('TELEGRAM_WEBHOOK_URL must be a valid HTTPS URL in production');
  });

  it('accepts complete integration configuration', () => {
    expect(() =>
      validateProductionRelayConfig({
        ...production(),
        DISCORD_BOT_TOKEN: 'bot-token',
        DISCORD_APPLICATION_ID: 'application-id',
        SIGNAL_CLI_PATH: '/usr/bin/signal-cli',
        SIGNAL_ACCOUNT: '+15555550123',
        THREADS_CLIENT_ID: 'client-id',
        THREADS_CLIENT_SECRET: 'client-secret',
        THREADS_WEBHOOK_VERIFY_TOKEN: 'verify-token',
        BLUEBUBBLES_URL: 'https://bluebubbles',
        BLUEBUBBLES_PASSWORD: 'password',
        BLUEBUBBLES_WEBHOOK_SECRET: 'webhook-secret',
        TELEGRAM_BOT_TOKEN: 'bot-token',
        TELEGRAM_WEBHOOK_URL: 'https://example.test/telegram',
        TELEGRAM_WEBHOOK_SECRET: 'telegram-webhook-secret-0123456789abcdef',
      }),
    ).not.toThrow();
  });

  it('does not impose production-only completeness rules on development', () => {
    expect(() =>
      validateProductionRelayConfig({ NODE_ENV: 'development', DISCORD_BOT_TOKEN: 'bot-token' }),
    ).not.toThrow();
  });
});
