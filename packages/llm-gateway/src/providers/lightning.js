// Lightning AI provider — OpenAI-compatible inference API
// https://lightning.ai/docs — platform API for hosted/open models
import { ProviderError } from './types.js';
export const LIGHTNING_BASE_URL = 'https://api.lightning.ai/v1';
export class LightningProvider {
    apiKey;
    model;
    name = 'lightning';
    constructor(apiKey, model = 'lightning-v2') {
        this.apiKey = apiKey;
        this.model = model;
    }
    async chat(messages, options) {
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
            cost: (res.usage.prompt_tokens * 0.0002 + res.usage.completion_tokens * 0.0008) / 1000,
        };
    }
    async *chatStream(messages, options) {
        try {
            for await (const delta of streamLightning(this.apiKey, {
                model: this.model,
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
                temperature: options?.temperature,
                max_tokens: options?.maxTokens,
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
export async function callLightning(apiKey, body, signal) {
    const res = await fetch(`${LIGHTNING_BASE_URL}/chat/completions`, {
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
        throw new Error(`Lightning API error ${res.status}: ${text}`);
    }
    return res.json();
}
export async function* streamLightning(apiKey, body, signal) {
    const res = await fetch(`${LIGHTNING_BASE_URL}/chat/completions`, {
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
        throw new Error(`Lightning stream error ${res.status}: ${text}`);
    }
    const reader = res.body?.getReader();
    if (!reader)
        throw new Error('Lightning stream body is null');
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
                if (!trimmed || trimmed === 'data: [DONE]')
                    continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const parsed = JSON.parse(trimmed.slice(6));
                        const delta = parsed.choices?.[0]?.delta?.content;
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
//# sourceMappingURL=lightning.js.map