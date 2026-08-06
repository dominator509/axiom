// Lightning AI provider — Anthropic Messages-compatible REST API
// https://lightning.ai/docs — Model APIs: POST https://lightning.ai/v1/messages
// Auth: Bearer <LIGHTNING_API_KEY> (verified live 2026-08-06; key format = UUID)
// NOTE: The OpenAI-style /v1/chat/completions surface on api.lightning.ai returns
// 401 even with a valid key — the Anthropic-shaped /v1/messages endpoint on
// lightning.ai is the live, working surface. Responses are translated to the
// shared OpenAI shape so the gateway dispatch stays uniform (same pattern as
// the Gemini provider).

import type {
  ProviderMessage,
  ProviderOptions,
  ProviderChatResult,
  ProviderStreamChunk,
  BaseProvider,
} from './types.js';
import { ProviderError } from './types.js';

export const LIGHTNING_BASE_URL = 'https://lightning.ai';

const DEFAULT_MAX_TOKENS = 1024;

export class LightningProvider implements BaseProvider {
  readonly name = 'lightning';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'claude-opus-4-7',
  ) {}

  async chat(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): Promise<ProviderChatResult> {
    const res = await callLightning(this.apiKey, {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    });
    return {
      content: res.choices[0]?.message?.content ?? '',
      model: res.model ?? this.model,
      usage: {
        promptTokens: res.usage.prompt_tokens,
        completionTokens: res.usage.completion_tokens,
        totalTokens: res.usage.total_tokens,
      },
      cost: (res.usage.prompt_tokens * 0.015 + res.usage.completion_tokens * 0.075) / 1000,
    };
  }

  async *chatStream(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): AsyncIterable<ProviderStreamChunk> {
    try {
      for await (const delta of streamLightning(this.apiKey, {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      })) {
        yield { type: 'delta', content: delta };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(msg, 0, this.name);
    }
  }
}

export interface LightningCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

// Anthropic Messages API response shape (translated to OpenAI shape below)
interface AnthropicMessageResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// OpenAI-shaped completion that the gateway dispatch consumes
export interface LightningCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function toOpenAICompat(res: AnthropicMessageResponse): LightningCompletionResponse {
  const content = res.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('');
  return {
    id: res.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: res.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: content || null },
        finish_reason: res.stop_reason ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: res.usage.input_tokens,
      completion_tokens: res.usage.output_tokens,
      total_tokens: res.usage.input_tokens + res.usage.output_tokens,
    },
  };
}

export async function callLightning(
  apiKey: string,
  body: LightningCompletionRequest,
  signal?: AbortSignal,
): Promise<LightningCompletionResponse> {
  // Anthropic Messages API requires max_tokens and has no role:'system' —
  // system messages are hoisted to the top-level `system` field.
  const systemParts = body.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const chatMessages = body.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const anthropicBody: Record<string, unknown> = {
    model: body.model,
    max_tokens: body.max_tokens ?? DEFAULT_MAX_TOKENS,
    messages: chatMessages,
  };
  if (systemParts) anthropicBody.system = systemParts;

  const res = await fetch(`${LIGHTNING_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(anthropicBody),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Lightning API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as AnthropicMessageResponse;
  return toOpenAICompat(data);
}

export async function* streamLightning(
  apiKey: string,
  body: LightningCompletionRequest,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const systemParts = body.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const chatMessages = body.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const anthropicBody: Record<string, unknown> = {
    model: body.model,
    max_tokens: body.max_tokens ?? DEFAULT_MAX_TOKENS,
    messages: chatMessages,
    stream: true,
  };
  if (systemParts) anthropicBody.system = systemParts;

  const res = await fetch(`${LIGHTNING_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(anthropicBody),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Lightning stream error ${res.status}: ${text}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Lightning stream body is null');
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Anthropic SSE: `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}`
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              const text = parsed.delta.text;
              if (text) yield text;
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
