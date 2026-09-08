// ─── Production integration configuration ──────────────────────────────────
// A partially configured adapter must fail startup instead of silently
// removing an operator control surface from an otherwise healthy API.

type ConfigValue = string | undefined;

function requireComplete(label: string, values: Array<ConfigValue>): void {
  const configured = values.filter((value) => Boolean(value?.trim())).length;
  if (configured > 0 && configured < values.length) {
    throw new Error(`${label} integration configuration is incomplete`);
  }
}

/**
 * Validate only production integration configuration. Development and test
 * environments may intentionally enable adapters incrementally.
 */
export function validateProductionRelayConfig(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;

  requireComplete('Discord', [env.DISCORD_BOT_TOKEN, env.DISCORD_APPLICATION_ID]);
  requireComplete('Signal', [env.SIGNAL_CLI_PATH, env.SIGNAL_ACCOUNT]);
  requireComplete('Threads', [
    env.THREADS_CLIENT_ID,
    env.THREADS_CLIENT_SECRET,
    env.THREADS_WEBHOOK_VERIFY_TOKEN,
  ]);
  requireComplete('BlueBubbles', [
    env.BLUEBUBBLES_URL,
    env.BLUEBUBBLES_PASSWORD ?? env.BLUEBUBBLES_API_KEY,
    env.BLUEBUBBLES_WEBHOOK_SECRET,
  ]);

  if (env.TELEGRAM_WEBHOOK_URL?.trim()) {
    if (!env.TELEGRAM_BOT_TOKEN?.trim()) {
      throw new Error('Telegram webhook configuration requires TELEGRAM_BOT_TOKEN');
    }
    const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      throw new Error('Telegram webhook configuration requires TELEGRAM_WEBHOOK_SECRET');
    }
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) {
      throw new Error(
        'TELEGRAM_WEBHOOK_SECRET must contain 32-256 letters, numbers, underscores, or hyphens',
      );
    }
  }
}
