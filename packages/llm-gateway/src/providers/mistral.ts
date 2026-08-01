// Mistral provider — https://docs.mistral.ai/api/

import type {
  ProviderMessage,
  ProviderOptions,
  ProviderChatResult,
  ProviderStreamChunk,
  BaseProvider,
} from './types.js';
import { ProviderError } from './types.js';

export const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';

export class MistralProvider implements BaseProvider {
  readonly name = 'mistral';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'mistral-small-latest',
  ) {}

  async chat(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): Promise<ProviderChatResult> {
    const res = await callMistral(this.apiKey, {
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
      cost: (res.usage.prompt_tokens * 0.0001 + res.usage.completion_tokens * 0.0003) / 1000,
    };
  }

  async *chatStream(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): AsyncIterable<ProviderStreamChunk> {
    try {
      for await (const delta of streamMistral(this.apiKey, {
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

export interface MistralCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface MistralCompletionResponse {
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

export async function callMistral(
  apiKey: string,
  body: MistralCompletionRequest,
  signal?: AbortSignal,
): Promise<MistralCompletionResponse> {
  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mistral API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<MistralCompletionResponse>;
}

export async function* streamMistral(
  apiKey: string,
  body: MistralCompletionRequest,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Mistral stream error ${res.status}: ${text}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Mistral stream body is null');
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
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield delta;
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
