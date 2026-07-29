export interface PlatformMetrics {
  connectionId: string;
  platform: string;
  remoteIds: string[];
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  revenue?: number;
  timestamp: number;
}

interface PollingSchedule {
  platform: string;
  intervalMs: number;
  lastPolled: number;
  active: boolean;
}

export class MetricPoller {
  private schedules: Map<string, PollingSchedule> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private metricsHistory: PlatformMetrics[] = [];
  private pollHandler?: (connectionId: string, platform: string, remoteIds: string[]) => Promise<PlatformMetrics>;

  setPollHandler(
    handler: (connectionId: string, platform: string, remoteIds: string[]) => Promise<PlatformMetrics>,
  ): void {
    this.pollHandler = handler;
  }

  addSchedule(platform: string, intervalMs: number): void {
    this.schedules.set(platform, {
      platform,
      intervalMs,
      lastPolled: 0,
      active: true,
    });
  }

  removeSchedule(platform: string): void {
    this.schedules.delete(platform);
    const interval = this.intervals.get(platform);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(platform);
    }
  }

  async pollPlatform(connectionId: string, platform: string, remoteIds: string[]): Promise<PlatformMetrics | null> {
    if (!this.pollHandler) return null;

    try {
      const metrics = await this.pollHandler(connectionId, platform, remoteIds);
      this.storeMetrics(metrics);
      return metrics;
    } catch (err) {
      console.error(`[MetricPoller] Poll failed for ${platform}/${connectionId}:`, err);
      return null;
    }
  }

  storeMetrics(metrics: PlatformMetrics): void {
    this.metricsHistory.push(metrics);
    // Keep last 10000 entries
    if (this.metricsHistory.length > 10000) {
      this.metricsHistory = this.metricsHistory.slice(-5000);
    }
  }

  startAll(): void {
    for (const [platform, schedule] of this.schedules) {
      if (schedule.active && !this.intervals.has(platform)) {
        const interval = setInterval(async () => {
          // Polling would be triggered here for active connections
          schedule.lastPolled = Date.now();
        }, schedule.intervalMs);
        this.intervals.set(platform, interval);
      }
    }
  }

  stopAll(): void {
    for (const [, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }

  getHistory(): PlatformMetrics[] {
    return [...this.metricsHistory];
  }

  getScheduleStatus(): PollingSchedule[] {
    return Array.from(this.schedules.values()).map((s) => ({
      ...s,
      active: this.intervals.has(s.platform),
    }));
  }
}
