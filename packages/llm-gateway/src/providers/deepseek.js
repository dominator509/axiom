// DeepSeek provider — https://api-docs.deepseek.com/api/create-chat-completion
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
export async function callDeepSeek(apiKey, body, signal, fetchImpl = fetch) {
    const res = await fetchImpl(`${DEEPSEEK_BASE_URL}/chat/completions`, {
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
        throw new Error(`DeepSeek API error ${res.status}: ${text}`);
    }
    return res.json();
}
export async function* streamDeepSeek(apiKey, body, signal, fetchImpl = fetch) {
    const res = await fetchImpl(`${DEEPSEEK_BASE_URL}/chat/completions`, {
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
        throw new Error(`DeepSeek stream error ${res.status}: ${text}`);
    }
    const reader = res.body?.getReader();
    if (!reader)
        throw new Error('DeepSeek stream body is null');
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
//# sourceMappingURL=deepseek.js.map