import { type Platform, type PublishInput, type PublishResult } from '@axiom/core';
export interface PrePostScript {
    name: string;
    /** Pre-publish hook: receives input + platform, returns modified input or throws */
    beforePublish: (input: PublishInput, platform: Platform) => PublishInput | Promise<PublishInput>;
    /** Post-publish hook: receives result + platform for analytics/logging */
    afterPublish: (result: PublishResult, platform: Platform) => void | Promise<void>;
}
export interface ScriptSandbox {
    /** Registered scripts, keyed by name */
    scripts: Map<string, PrePostScript>;
    /** Globals available to sandboxed scripts */
    globals: Record<string, unknown>;
}
export declare class PrePostHook {
    private sandbox;
    constructor(globals?: Record<string, unknown>);
    /**
     * Register a pre-post script in the execution sandbox.
     */
    registerScript(script: PrePostScript): void;
    /**
     * Unregister a script by name.
     */
    unregisterScript(name: string): boolean;
    /**
     * Get a registered script by name.
     */
    getScript(name: string): PrePostScript | undefined;
    /**
     * List all registered script names.
     */
    listScripts(): string[];
    /**
     * Run the pre-publish pipeline for a given input and platform.
     * Each registered script's beforePublish is called in registration order,
     * with each script receiving the output of the previous script.
     */
    beforePublish(input: PublishInput, platform: Platform): Promise<PublishInput>;
    /**
     * Run the post-publish pipeline for a given result and platform.
     * Each registered script's afterPublish is called in registration order.
     * Errors are logged but do not propagate (fire-and-forget).
     */
    afterPublish(result: PublishResult, platform: Platform): Promise<void>;
    /**
     * Clear all registered scripts.
     */
    clearScripts(): void;
}
//# sourceMappingURL=prepost.d.ts.map