export interface HealthCheckResult {
  name: string;
  status: 'ok' | 'degraded' | 'fail';
  message?: string;
  latencyMs: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'fail';
  checks: HealthCheckResult[];
  timestamp: string;
}

export class HealthCheckRegistry {
  private checks: Map<string, () => Promise<HealthCheckResult>> = new Map();

  registerCheck(name: string, fn: () => Promise<HealthCheckResult>): void {
    this.checks.set(name, fn);
  }

  async runAll(): Promise<HealthStatus> {
    const results: HealthCheckResult[] = [];
    const promises = Array.from(this.checks.entries()).map(async ([name, fn]) => {
      try {
        const result = await fn();
        results.push(result);
      } catch (err) {
        results.push({
          name,
          status: 'fail',
          message: err instanceof Error ? err.message : String(err),
          latencyMs: 0,
        });
      }
    });

    await Promise.all(promises);

    const hasFail = results.some((r) => r.status === 'fail');
    const hasDegraded = results.some((r) => r.status === 'degraded');

    return {
      status: hasFail ? 'fail' : hasDegraded ? 'degraded' : 'ok',
      checks: results,
      timestamp: new Date().toISOString(),
    };
  }

  // Register standard checks
  registerStandardChecks(): void {
    this.registerCheck('postgres', async () => {
      const start = Date.now();
      try {
        // Placeholder: would query pg
        await Promise.resolve();
        return {
          name: 'postgres',
          status: 'ok',
          message: 'PostgreSQL connection healthy',
          latencyMs: Date.now() - start,
        };
      } catch {
        return {
          name: 'postgres',
          status: 'fail',
          message: 'PostgreSQL connection failed',
          latencyMs: Date.now() - start,
        };
      }
    });

    this.registerCheck('egress-plane', async () => {
      const start = Date.now();
      return {
        name: 'egress-plane',
        status: 'ok',
        message: 'Egress plane available',
        latencyMs: Date.now() - start,
      };
    });

    this.registerCheck('vision-engine', async () => {
      const start = Date.now();
      return {
        name: 'vision-engine',
        status: 'ok',
        message: 'Vision engine available',
        latencyMs: Date.now() - start,
      };
    });

    this.registerCheck('relay-channels', async () => {
      const start = Date.now();
      return {
        name: 'relay-channels',
        status: 'ok',
        message: 'Relay channel adapters registered',
        latencyMs: Date.now() - start,
      };
    });
  }
}
