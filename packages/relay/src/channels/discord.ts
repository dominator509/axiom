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
import { CommandRouter, type CommandContext } from '../commands.js';

export interface DiscordConfig {
  token: string;
  clientId: string;
}

type CommandHandler = (
  action: CardAction,
  cardId: string,
  context?: CommandContext,
) => Promise<void>;

export class DiscordAdapter {
  private client: Client;
  private renderer: CardRenderer;
  private handlers: Map<string, CommandHandler> = new Map();
  private commandRouter?: CommandRouter;
  private interactionHandlerRegistered = false;

  constructor(private config: DiscordConfig, commandRouter?: CommandRouter) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
    this.renderer = new CardRenderer();
    this.commandRouter = commandRouter;
  }

  getClient(): Client {
    return this.client;
  }

  onCommand(
    action: CardAction,
    handler: CommandHandler,
  ): void {
    this.handlers.set(action, handler);
  }

  async sendCard(channelId: string, card: RelayCard): Promise<void> {
    if (!card.cardId) throw new Error('relay card missing persistent card id');
    const embedData = this.renderer.toEmbed(card);
    const embed = new EmbedBuilder(embedData as any);

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    for (const action of card.actions) {
      const commandToken = card.commandTokens?.[action];
      if (!commandToken) {
        throw new Error(`relay card missing signed command token for ${action}`);
      }
      const button = new ButtonBuilder()
        .setCustomId(commandToken)
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
    if (!this.commandRouter) return;
    const command = this.commandRouter.verifyCommandToken(interaction.customId);
    if (!command) return;
    const sourceId = interaction.channelId;
    if (!sourceId) return;
    const handler = this.handlers.get(command.action);
    if (!handler) return;
    await handler(command.action, command.cardId, {
      channel: 'discord',
      sourceId,
    });
    await interaction.reply({ content: `Action processed`, ephemeral: true });
  }

  async login(): Promise<void> {
    await this.client.login(this.config.token);
  }

  registerInteractionHandler(): void {
    if (this.interactionHandlerRegistered) return;
    this.interactionHandlerRegistered = true;
    this.client.on('interactionCreate', (interaction) => {
      void this.handleInteraction(interaction).catch((error) => {
        console.error('Discord relay interaction failed', error);
      });
    });
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
