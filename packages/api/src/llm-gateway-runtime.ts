import { LLMGateway } from '@axiom/llm-gateway';

/**
 * Runtime-only provider configuration. API credentials stay in the server
 * process and are never returned by the provider capability endpoint.
 */
export function createRuntimeLlmGateway(): LLMGateway {
  const apiKey = process.env.VENICE_API_KEY?.trim();
  const model = process.env.VENICE_MODEL?.trim();
  const providerOverrides = apiKey && model && model.length <= 128
    ? [{ name: 'venice', apiKey, defaultModel: model }]
    : [];

  return new LLMGateway(providerOverrides);
}
