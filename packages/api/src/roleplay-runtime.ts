import { createRuntimeLlmGateway } from './llm-gateway-runtime.js';

/**
 * Shared provider boundary for Chatter and private inbox drafting.
 * Both surfaces use the same authenticated subscription transport; neither
 * surface is allowed to publish a provider message as part of generation.
 */
export const roleplayGateway = createRuntimeLlmGateway();
export const ROLEPLAY_PROVIDER_MODEL = 'grok-roleplayer';
