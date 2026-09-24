// Shared Relay binding preflight for every provider-dispatching card executor.
// Keep this check before the first provider side effect so a bad later binding
// cannot leave an earlier binding with an untracked external outcome.

export type RelayBindingForDispatch = {
  id: string;
  channel: string;
  chatRef: string | null;
};

const SUPPORTED_RELAY_CHANNELS = new Set(['telegram', 'discord', 'signal', 'imessage']);

export function assertRelayBindingDispatchable(
  binding: RelayBindingForDispatch,
  env: Record<string, string | undefined> = process.env,
): string {
  const channel = binding.channel.trim().toLowerCase();
  if (!SUPPORTED_RELAY_CHANNELS.has(channel)) {
    throw new Error(`relay dispatch: channel '${binding.channel}' dispatch not implemented`);
  }
  if (!binding.chatRef?.trim()) {
    throw new Error(`relay dispatch: binding ${binding.id} has no chat_ref`);
  }

  switch (channel) {
    case 'telegram':
      if (!env.TELEGRAM_BOT_TOKEN) {
        throw new Error('relay dispatch: TELEGRAM_BOT_TOKEN not configured');
      }
      break;
    case 'discord':
      if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APPLICATION_ID) {
        throw new Error('relay dispatch: Discord bot env not configured');
      }
      break;
    case 'signal':
      if (!env.SIGNAL_CLI_PATH || !env.SIGNAL_ACCOUNT) {
        throw new Error('relay dispatch: Signal CLI env not configured');
      }
      break;
    case 'imessage':
      if (!env.BLUEBUBBLES_URL || !(env.BLUEBUBBLES_PASSWORD ?? env.BLUEBUBBLES_API_KEY)) {
        throw new Error('relay dispatch: BlueBubbles env not configured');
      }
      break;
  }

  return channel;
}
