import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Interaction,
  TextChannel,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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
    if (
      typeof (interaction as any).isModalSubmit === 'function' &&
      (interaction as any).isModalSubmit()
    ) {
      await this.handleModalSubmit(interaction as any);
      return;
    }
    if (!interaction.isButton()) return;
    if (!this.commandRouter) return;
    const pending = this.commandRouter.peekCommandToken(interaction.customId);
    if (pending && isParameterizedAction(pending.action)) {
      await interaction.showModal(createActionModal(pending.action, interaction.customId));
      return;
    }
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

  private async handleModalSubmit(interaction: any): Promise<void> {
    if (!this.commandRouter) return;
    const command = this.commandRouter.verifyCommandToken(interaction.customId);
    if (!command || !isParameterizedAction(command.action)) return;
    const sourceId = interaction.channelId;
    if (!sourceId) return;
    const handler = this.handlers.get(command.action);
    if (!handler) return;

    const params =
      command.action === 'edit_caption'
        ? {
            caption: interaction.fields.getTextInputValue('caption'),
            ...(interaction.fields.getTextInputValue('platform').trim()
              ? { platform: interaction.fields.getTextInputValue('platform').trim() }
              : {}),
          }
        : { scheduledFor: interaction.fields.getTextInputValue('scheduledFor') };
    await handler(command.action, command.cardId, {
      channel: 'discord',
      sourceId,
      params,
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
      publish_now: '🚀 Publish Now',
    };
    return labels[action];
  }

  private actionStyle(action: CardAction): ButtonStyle {
    switch (action) {
      case 'approve':
      case 'approve_all':
      case 'publish_now':
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

function isParameterizedAction(action: CardAction): action is 'edit_caption' | 'reschedule' {
  return action === 'edit_caption' || action === 'reschedule';
}

function createActionModal(
  action: 'edit_caption' | 'reschedule',
  token: string,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(token)
    .setTitle(action === 'edit_caption' ? 'Edit caption' : 'Reschedule publish');
  if (action === 'edit_caption') {
    const platform = new TextInputBuilder()
      .setCustomId('platform')
      .setLabel('Platform (optional when unambiguous)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);
    const caption = new TextInputBuilder()
      .setCustomId('caption')
      .setLabel('New caption')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(platform),
      new ActionRowBuilder<TextInputBuilder>().addComponents(caption),
    );
  } else {
    const scheduledFor = new TextInputBuilder()
      .setCustomId('scheduledFor')
      .setLabel('Future ISO-8601 timestamp')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(scheduledFor));
  }
  return modal;
}
