// Google Gemini provider — https://ai.google.dev/api/generate-content
// Gemini uses its own generateContent protocol (NOT OpenAI-shaped), so
// callGoogle/streamGoogle translate to/from the shared gateway shape.

import type {
  ProviderMessage,
  ProviderOptions,
  ProviderChatResult,
  ProviderStreamChunk,
  BaseProvider,
} from './types.js';
import { ProviderError } from './types.js';

export const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GoogleProvider implements BaseProvider {
  readonly name = 'google';

  constructor(
    private readonly apiKey: string,
    readonly model: string = 'gemini-2.0-flash',
  ) {}

  async chat(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): Promise<ProviderChatResult> {
    const res = await callGoogle(this.apiKey, {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
      stop: options?.stop,
    });
    return {
      content: res.choices[0]?.message?.content ?? '',
      model: res.model ?? this.model,
      usage: {
        promptTokens: res.usage.prompt_tokens,
        completionTokens: res.usage.completion_tokens,
        totalTokens: res.usage.total_tokens,
      },
      cost: (res.usage.prompt_tokens * 0.0001 + res.usage.completion_tokens * 0.0004) / 1000,
    };
  }

  async *chatStream(
    messages: ProviderMessage[],
    options?: ProviderOptions,
  ): AsyncIterable<ProviderStreamChunk> {
    try {
      for await (const delta of streamGoogle(this.apiKey, {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
        top_p: options?.topP,
        stop: options?.stop,
      })) {
        yield { type: 'delta', content: delta };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(msg, 0, this.name);
    }
  }
}

export interface GoogleGenerateRequest {
  model: string;
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    stopSequences?: string[];
  };
}

export interface GoogleGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  error?: { code: number; message: string; status: string };
}

// The gateway expects OpenAI-shaped responses; this translates Gemini output.
export interface OpenAICompatCompletionResponse {
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

function toOpenAICompat(
  data: GoogleGenerateResponse,
  model: string,
): OpenAICompatCompletionResponse {
  if (data.error) {
    throw new Error(`Gemini API error ${data.error.code}: ${data.error.message}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  return {
    id: `gemini-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text || null },
        finish_reason: data.candidates?.[0]?.finishReason ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}

function toGenerateRequest(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; max_tokens?: number; top_p?: number; stop?: string[] },
): GoogleGenerateRequest {
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const contents = chatMessages.map(m => ({
    role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    parts: [{ text: m.content }],
  }));
  const generationConfig: GoogleGenerateRequest['generationConfig'] = {};
  if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
  if (options?.max_tokens !== undefined) generationConfig.maxOutputTokens = options.max_tokens;
  if (options?.top_p !== undefined) generationConfig.topP = options.top_p;
  if (options?.stop !== undefined && options.stop.length > 0) generationConfig.stopSequences = options.stop;
  return {
    model,
    contents,
    ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
}

export async function callGoogle(
  apiKey: string,
  body: { model: string; messages: Array<{ role: string; content: string }>; temperature?: number; max_tokens?: number; top_p?: number; stop?: string[] },
  signal?: AbortSignal,
): Promise<OpenAICompatCompletionResponse> {
  const req = toGenerateRequest(body.model, body.messages, body);
  const res = await fetch(
    `${GOOGLE_BASE_URL}/models/${encodeURIComponent(body.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as GoogleGenerateResponse;
  return toOpenAICompat(data, body.model);
}

export async function* streamGoogle(
  apiKey: string,
  body: { model: string; messages: Array<{ role: string; content: string }>; temperature?: number; max_tokens?: number; top_p?: number; stop?: string[] },
  signal?: AbortSignal,
): AsyncIterable<string> {
  const req = toGenerateRequest(body.model, body.messages, body);
  const res = await fetch(
    `${GOOGLE_BASE_URL}/models/${encodeURIComponent(body.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini stream error ${res.status}: ${text}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Gemini stream body is null');
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
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6)) as GoogleGenerateResponse;
            const delta = parsed.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
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
