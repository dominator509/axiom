import type { Executor } from './context.js';
export interface WeeklyDigest {
    weekStart: string;
    posts: number;
    views: number;
    likes: number;
    shares: number;
    comments: number;
    avgEngagement: number;
    topPlatform: string;
    viralPosts: number;
    strongPosts: number;
}
export declare const digestWeekly: Executor;
//# sourceMappingURL=digest.d.ts.map