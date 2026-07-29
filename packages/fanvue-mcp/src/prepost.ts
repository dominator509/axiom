import { type Platform, type PublishInput, type PublishResult } from '@axiom/core';
import { FanvueMcpClient } from './client.js';

// ─── Script Types ───

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

// ─── Pre-Post Hook ───

export class PrePostHook {
  private sandbox: ScriptSandbox;

  constructor(globals?: Record<string, unknown>) {
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
  registerScript(script: PrePostScript): void {
    if (this.sandbox.scripts.has(script.name)) {
      throw new Error(
        `PrePostScript "${script.name}" is already registered. Remove it first to re-register.`,
      );
    }
    this.sandbox.scripts.set(script.name, script);
  }

  /**
   * Unregister a script by name.
   */
  unregisterScript(name: string): boolean {
    return this.sandbox.scripts.delete(name);
  }

  /**
   * Get a registered script by name.
   */
  getScript(name: string): PrePostScript | undefined {
    return this.sandbox.scripts.get(name);
  }

  /**
   * List all registered script names.
   */
  listScripts(): string[] {
    return Array.from(this.sandbox.scripts.keys());
  }

  /**
   * Run the pre-publish pipeline for a given input and platform.
   * Each registered script's beforePublish is called in registration order,
   * with each script receiving the output of the previous script.
   */
  async beforePublish(
    input: PublishInput,
    platform: Platform,
  ): Promise<PublishInput> {
    let current = structuredClone(input);

    for (const [name, script] of this.sandbox.scripts) {
      try {
        current = await script.beforePublish(current, platform);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        throw new Error(
          `PrePublish script "${name}" failed for ${platform}: ${message}`,
        );
      }
    }

    return current;
  }

  /**
   * Run the post-publish pipeline for a given result and platform.
   * Each registered script's afterPublish is called in registration order.
   * Errors are logged but do not propagate (fire-and-forget).
   */
  async afterPublish(
    result: PublishResult,
    platform: Platform,
  ): Promise<void> {
    for (const [name, script] of this.sandbox.scripts) {
      try {
        await script.afterPublish(result, platform);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        console.error(
          `[PrePostHook] afterPublish script "${name}" failed for ${platform}: ${message}`,
        );
      }
    }
  }

  /**
   * Clear all registered scripts.
   */
  clearScripts(): void {
    this.sandbox.scripts.clear();
  }
}
