import { FanvueMcpClient } from './client.js';
// ─── Pre-Post Hook ───
export class PrePostHook {
    sandbox;
    constructor(globals) {
        this.sandbox = {
            scripts: new Map(),
            globals: {
                mcpClient: new FanvueMcpClient(),
                Date,
                Math,
                JSON,
                console,
                setTimeout,
                fetch,
                ...globals,
            },
        };
    }
    /**
     * Register a pre-post script in the execution sandbox.
     */
    registerScript(script) {
        if (this.sandbox.scripts.has(script.name)) {
            throw new Error(`PrePostScript "${script.name}" is already registered. Remove it first to re-register.`);
        }
        this.sandbox.scripts.set(script.name, script);
    }
    /**
     * Unregister a script by name.
     */
    unregisterScript(name) {
        return this.sandbox.scripts.delete(name);
    }
    /**
     * Get a registered script by name.
     */
    getScript(name) {
        return this.sandbox.scripts.get(name);
    }
    /**
     * List all registered script names.
     */
    listScripts() {
        return Array.from(this.sandbox.scripts.keys());
    }
    /**
     * Run the pre-publish pipeline for a given input and platform.
     * Each registered script's beforePublish is called in registration order,
     * with each script receiving the output of the previous script.
     */
    async beforePublish(input, platform) {
        let current = structuredClone(input);
        for (const [name, script] of this.sandbox.scripts) {
            try {
                current = await script.beforePublish(current, platform);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new Error(`PrePublish script "${name}" failed for ${platform}: ${message}`);
            }
        }
        return current;
    }
    /**
     * Run the post-publish pipeline for a given result and platform.
     * Each registered script's afterPublish is called in registration order.
     * Errors are logged but do not propagate (fire-and-forget).
     */
    async afterPublish(result, platform) {
        for (const [name, script] of this.sandbox.scripts) {
            try {
                await script.afterPublish(result, platform);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[PrePostHook] afterPublish script "${name}" failed for ${platform}: ${message}`);
            }
        }
    }
    /**
     * Clear all registered scripts.
     */
    clearScripts() {
        this.sandbox.scripts.clear();
    }
}
//# sourceMappingURL=prepost.js.map