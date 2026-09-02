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

export interface StandardHealthProbes {
  postgres: () => Promise<void>;
  egressPlane: () => Promise<void>;
  visionEngine: () => Promise<void>;
  relayChannels: () => Promise<void>;
}

export class HealthCheckRegistry {
  private checks: Map<string, () => Promise<HealthCheckResult>> = new Map();

  registerCheck(name: string, fn: () => Promise<HealthCheckResult>): void {
    this.checks.set(name, fn);
  }

  async runAll(): Promise<HealthStatus> {
    if (this.checks.size === 0) {
      return {
        status: 'fail',
        checks: [
          {
            name: 'health-registry',
            status: 'fail',
            message: 'No health checks are registered',
            latencyMs: 0,
          },
        ],
        timestamp: new Date().toISOString(),
      };
    }

    const results: HealthCheckResult[] = [];
    const promises = Array.from(this.checks.entries()).map(async ([name, fn]) => {
      const start = Date.now();
      try {
        const result = await fn();
        results.push(result);
      } catch (err) {
        results.push({
          name,
          status: 'fail',
          message: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - start,
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

  /**
   * Register the standard dependency checks using real, caller-owned probes.
   * Keeping the I/O outside this package lets the API inject its DB and
   * service clients without turning this persistence-free relay package into
   * a source of fabricated health signals.
   */
  registerStandardChecks(probes: StandardHealthProbes): void {
    const registerProbe = (name: string, message: string, probe: () => Promise<void>): void => {
      this.registerCheck(name, async () => {
        const start = Date.now();
        await probe();
        return {
          name,
          status: 'ok',
          message,
          latencyMs: Date.now() - start,
        };
      });
    };

    registerProbe('postgres', 'PostgreSQL connection healthy', probes.postgres);
    registerProbe('egress-plane', 'Egress plane available', probes.egressPlane);
    registerProbe('vision-engine', 'Vision engine available', probes.visionEngine);
    registerProbe('relay-channels', 'Relay channel adapters registered', probes.relayChannels);
  }
}
