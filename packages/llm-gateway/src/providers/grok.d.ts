export declare const GROK_BASE_URL = "https://api.x.ai/v1";
export interface GrokCompletionRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
}
export interface GrokCompletionResponse {
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
export declare function callGrok(apiKey: string, body: GrokCompletionRequest, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<GrokCompletionResponse>;
export declare function streamGrok(apiKey: string, body: GrokCompletionRequest, signal?: AbortSignal, fetchImpl?: typeof fetch): AsyncIterable<string>;
//# sourceMappingURL=grok.d.ts.map