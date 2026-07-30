// Shared types for LLM Gateway providers
export class ProviderError extends Error {
    status;
    provider;
    body;
    constructor(message, status, provider, body) {
        super(message);
        this.status = status;
        this.provider = provider;
        this.body = body;
        this.name = 'ProviderError';
    }
}
//# sourceMappingURL=types.js.map