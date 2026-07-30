import type { Message } from './gateway.js';
export interface PipelineTransform {
    name: string;
    before?: (messages: Message[], options: PipelineOptions) => Promise<[Message[], PipelineOptions]>;
    after?: (result: PipelineResult) => Promise<PipelineResult>;
}
export interface PipelineOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
}
export interface PipelineResult {
    content: string;
    model: string;
    provider: string;
    cost: number;
    tokens: {
        prompt: number;
        completion: number;
        total: number;
    };
    latency: number;
}
export declare class Pipeline {
    private transforms;
    use(transform: PipelineTransform): this;
    remove(name: string): boolean;
    runBefore(messages: Message[], options: PipelineOptions): Promise<[Message[], PipelineOptions]>;
    runAfter(result: PipelineResult): Promise<PipelineResult>;
    list(): PipelineTransform[];
}
//# sourceMappingURL=pipeline.d.ts.map