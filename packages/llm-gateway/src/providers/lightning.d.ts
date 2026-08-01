import type { ProviderMessage, ProviderOptions, ProviderChatResult, ProviderStreamChunk, BaseProvider } from './types.js';
export declare const LIGHTNING_BASE_URL = "https://api.lightning.ai/v1";
export declare class LightningProvider implements BaseProvider {
    private readonly apiKey;
    readonly model: string;
    readonly name = "lightning";
    constructor(apiKey: string, model?: string);
    chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult>;
    chatStream(messages: ProviderMessage[], options?: ProviderOptions): AsyncIterable<ProviderStreamChunk>;
}
export interface LightningCompletionRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
}
export interface LightningCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string | null;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export declare function callLightning(apiKey: string, body: LightningCompletionRequest, signal?: AbortSignal): Promise<LightningCompletionResponse>;
export declare function streamLightning(apiKey: string, body: LightningCompletionRequest, signal?: AbortSignal): AsyncIterable<string>;
//# sourceMappingURL=lightning.d.ts.map