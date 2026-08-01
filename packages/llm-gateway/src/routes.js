// HTTP routes for the LLM Gateway — mounted as a Hono sub-route
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ProviderError } from './providers/types.js';
const chatBodySchema = z.object({
    messages: z.array(z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
    })),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    policy: z.enum(['cost', 'latency', 'quality']).optional(),
    provider: z.string().optional(),
    stream: z.boolean().optional(),
});
export function createRouter(gateway) {
    const router = new Hono();
    // POST /chat — non-streaming completion
    router.post('/chat', zValidator('json', chatBodySchema), async (c) => {
        const { messages, model, temperature, maxTokens, policy, provider } = c.req.valid('json');
        try {
            const result = await gateway.chat(messages, {
                model,
                temperature,
                maxTokens,
                policy,
                provider,
            });
            return c.json(result);
        }
        catch (err) {
            const status = (err instanceof ProviderError ? err.status : 502);
            const msg = err instanceof Error ? err.message : 'LLM gateway error';
            return c.json({ error: { message: msg, provider: err instanceof ProviderError ? err.provider : undefined } }, status);
        }
    });
    // POST /chat/stream — streaming completion via SSE
    router.post('/chat/stream', zValidator('json', chatBodySchema), async (c) => {
        const { messages, model, temperature, maxTokens, policy, provider } = c.req.valid('json');
        const stream = gateway.chatStream(messages, {
            model,
            temperature,
            maxTokens,
            policy,
            provider,
        });
        return new Response(new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of await stream) {
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
                    }
                    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : 'Stream error';
                    controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${msg}\n\n`));
                }
                finally {
                    controller.close();
                }
            },
        }), {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
        });
    });
    // GET /providers — list available providers
    router.get('/providers', (c) => {
        return c.json({ providers: gateway.getAvailableProviders() });
    });
    // GET /stats — cache stats
    router.get('/stats', (c) => {
        return c.json(gateway.getStats());
    });
    return router;
}
//# sourceMappingURL=routes.js.map