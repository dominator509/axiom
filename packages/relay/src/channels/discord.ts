import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Interaction,
  TextChannel,
} from 'discord.js';
import type { RelayCard, CardAction } from '../card.js';
import { CardRenderer } from '../card.js';

export interface DiscordConfig {
  token: string;
  clientId: string;
}

export class DiscordAdapter {
  private client: Client;
  private renderer: CardRenderer;
  private handlers: Map<string, (action: CardAction, bundleId: string) => Promise<void>> =
    new Map();

  constructor(private config: DiscordConfig) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
    this.renderer = new CardRenderer();
  }

  getClient(): Client {
    return this.client;
  }

  onCommand(
    action: CardAction,
    handler: (action: CardAction, bundleId: string) => Promise<void>,
  ): void {
    this.handlers.set(action, handler);
  }

  async sendCard(channelId: string, card: RelayCard): Promise<void> {
    const embedData = this.renderer.toEmbed(card);
    const embed = new EmbedBuilder(embedData as any);

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    for (const action of card.actions) {
      const button = new ButtonBuilder()
        .setCustomId(`${action}:${card.bundleId}`)
        .setLabel(this.actionLabel(action))
        .setStyle(this.actionStyle(action));

      currentRow.addComponents(button);
      if (currentRow.components.length >= 5) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
      }
    }
    if (currentRow.components.length > 0) {
      rows.push(currentRow);
    }

    const channel = await this.client.channels.fetch(channelId);
    if (channel instanceof TextChannel) {
      await channel.send({ embeds: [embed], components: rows });
    }
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton()) return;
    const [action, bundleId] = interaction.customId.split(':');
    const handler = this.handlers.get(action as CardAction);
    if (handler) {
      await handler(action as CardAction, bundleId);
      await interaction.reply({ content: `Action "${action}" processed`, ephemeral: true });
    }
  }

  async login(): Promise<void> {
    await this.client.login(this.config.token);
  }

  private actionLabel(action: CardAction): string {
    const labels: Record<CardAction, string> = {
      approve: '✅ Approve',
      approve_all: '✅✅ All',
      reject: '❌ Reject',
      edit_caption: '✏️ Edit',
      change_price: '💰 Price',
      reschedule: '📅 Schedule',
      regenerate: '🔄 Regenerate',
      revise: '🔧 Revise',
      hold: '⏸️ Hold',
    };
    return labels[action];
  }

  private actionStyle(action: CardAction): ButtonStyle {
    switch (action) {
      case 'approve':
      case 'approve_all':
        return ButtonStyle.Success;
      case 'reject':
        return ButtonStyle.Danger;
      case 'hold':
        return ButtonStyle.Secondary;
      default:
        return ButtonStyle.Primary;
    }
  }
}
