import { PrePostHook } from '@axiom/fanvue-mcp';
import type { ConnectorPublishInput } from '@axiom/connectors';
import type { ExecutorContext } from './context.js';
export interface PrePostRunInput {
    targetId: string;
    bundleId: string;
    platform: string;
    modelId: string;
    caption: string;
    mediaUrls: string[];
    hashtags: string[];
    phase: 'before' | 'after';
}
export interface PrePostStageResult {
    input: ConnectorPublishInput;
    staged: boolean;
    engine: string;
    runId: string;
    scriptResults: Array<{
        name: string;
        ok: boolean;
        error?: string;
    }>;
}
export declare function getPrePostHook(): PrePostHook;
/**
 * Check the Rust media plane is reachable (L2.10 v2 isolated execution).
 * Returns the engine label actually used.
 */
export declare function mediaPlaneEngine(mediaPlaneUrl?: string): Promise<'rust-media-plane' | 'in-process'>;
/**
 * Run the before-publish stage: media-plane staging (when available) then the
 * registered PrePostHook scripts, recording the run in pre_post_run.
 */
export declare function runPrePostBefore(ctx: ExecutorContext, input: PrePostRunInput): Promise<PrePostStageResult>;
/**
 * Run the after-publish stage, recording the run in pre_post_run.
 */
export declare function runPrePostAfter(ctx: ExecutorContext, input: PrePostRunInput, result: unknown): Promise<PrePostStageResult>;
//# sourceMappingURL=pre_post.d.ts.map