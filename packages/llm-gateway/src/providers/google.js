// Google Gemini provider — https://ai.google.dev/api/generate-content
// Gemini uses its own generateContent protocol (NOT OpenAI-shaped), so
// callGoogle/streamGoogle translate to/from the shared gateway shape.
import { ProviderError } from './types.js';
export const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export class GoogleProvider {
    apiKey;
    model;
    name = 'google';
    constructor(apiKey, model = 'gemini-flash-latest') {
        this.apiKey = apiKey;
        this.model = model;
    }
    async chat(messages, options) {
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
    async *chatStream(messages, options) {
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new ProviderError(msg, 0, this.name);
        }
    }
}
function toOpenAICompat(data, model) {
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
function toGenerateRequest(model, messages, options) {
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    const contents = chatMessages.map(m => ({
        role: (m.role === 'assistant' ? 'model' : 'user'),
        parts: [{ text: m.content }],
    }));
    const generationConfig = {};
    if (options?.temperature !== undefined)
        generationConfig.temperature = options.temperature;
    if (options?.max_tokens !== undefined)
        generationConfig.maxOutputTokens = options.max_tokens;
    if (options?.top_p !== undefined)
        generationConfig.topP = options.top_p;
    if (options?.stop !== undefined && options.stop.length > 0)
        generationConfig.stopSequences = options.stop;
    return {
        model,
        contents,
        ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
        ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    };
}
export async function callGoogle(apiKey, body, signal) {
    const req = toGenerateRequest(body.model, body.messages, body);
    const res = await fetch(`${GOOGLE_BASE_URL}/models/${encodeURIComponent(body.model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini API error ${res.status}: ${text}`);
    }
    const data = (await res.json());
    return toOpenAICompat(data, body.model);
}
export async function* streamGoogle(apiKey, body, signal) {
    const req = toGenerateRequest(body.model, body.messages, body);
    const res = await fetch(`${GOOGLE_BASE_URL}/models/${encodeURIComponent(body.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini stream error ${res.status}: ${text}`);
    }
    const reader = res.body?.getReader();
    if (!reader)
        throw new Error('Gemini stream body is null');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const parsed = JSON.parse(trimmed.slice(6));
                        const delta = parsed.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
                        if (delta)
                            yield delta;
                    }
                    catch {
                        // skip malformed lines
                    }
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
//# sourceMappingURL=google.js.map