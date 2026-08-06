import type { Executor } from './context.js';
export declare function evaluateTextToS(caption: string, hashtags: string[], platforms: string[]): {
    verdict: 'pass' | 'review' | 'block';
    scores: Array<{
        platform: string;
        score: number;
        threshold: number;
        verdict: string;
        reasons: string[];
    }>;
    reasons: string[];
};
export declare const tosScan: Executor;
//# sourceMappingURL=tos.d.ts.map