export interface ProviderMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface ProviderOptions {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    stop?: string[];
}
export interface ProviderChatResult {
    content: string;
    model: string;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    cost: number;
}
export interface ProviderStreamChunk {
    type: 'text' | 'delta' | 'done';
    content?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    cost?: number;
}
export interface BaseProvider {
    readonly name: string;
    readonly model: string;
    chat(messages: ProviderMessage[], options?: ProviderOptions): Promise<ProviderChatResult>;
    chatStream(messages: ProviderMessage[], options?: ProviderOptions): AsyncIterable<ProviderStreamChunk>;
}
export declare class ProviderError extends Error {
    readonly status: number;
    readonly provider: string;
    readonly body?: string | undefined;
    constructor(message: string, status: number, provider: string, body?: string | undefined);
}
//# sourceMappingURL=types.d.ts.map