import type { ProviderMessage, ProviderOptions, ProviderChatResult, ProviderStreamChunk, BaseProvider } from './types.js';
export declare class AnthropicProvider implements BaseProvider {
    private readonly apiKey;
    readonly model: string;
    private readonly apiVersion;
    private readonly baseUrl;
    readonly name = "anthropic";
    constructor(apiKey: string, model?: string, apiVersion?: string, baseUrl?: string);
    chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult>;
    chatStream(messages: ProviderMessage[], options?: ProviderOptions): AsyncIterable<ProviderStreamChunk>;
}
export declare const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export interface AnthropicMessageRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    max_tokens: number;
    temperature?: number;
    stream?: boolean;
    system?: string;
}
export interface AnthropicMessageResponse {
    id: string;
    type: string;
    role: string;
    content: Array<{
        type: string;
        text: string;
    }>;
    model: string;
    stop_reason: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}
export declare function callAnthropic(apiKey: string, body: AnthropicMessageRequest, signal?: AbortSignal): Promise<AnthropicMessageResponse>;
export declare function streamAnthropic(apiKey: string, body: AnthropicMessageRequest, signal?: AbortSignal): AsyncIterable<string>;
//# sourceMappingURL=anthropic.d.ts.map