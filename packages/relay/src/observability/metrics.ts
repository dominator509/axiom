export interface Counter {
  name: string;
  help: string;
  value: number;
  labels: Record<string, string>;
}

export interface Histogram {
  name: string;
  help: string;
  buckets: number[];
  values: number[];
  sum: number;
  count: number;
}

export class MetricsRegistry {
  private counters: Map<string, Counter[]> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private counterHelp: Map<string, string> = new Map();

  private labelsToString(labels: Record<string, string>): string {
    return Object.entries(labels)
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
      .sort()
      .join(',');
  }

  registerCounter(name: string, help: string): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, []);
      this.counterHelp.set(name, help);
    }
  }

  incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    if (!this.counters.has(name)) {
      this.registerCounter(name, '');
    }
    const counters = this.counters.get(name)!;
    const labelStr = this.labelsToString(labels);
    const existing = counters.find((c) => this.labelsToString(c.labels) === labelStr);
    if (existing) {
      existing.value += value;
    } else {
      counters.push({ name, help: '', value, labels, ...labels });
    }
  }

  registerHistogram(name: string, help: string, buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, { name, help, buckets, values: new Array(buckets.length + 1).fill(0), sum: 0, count: 0 });
    }
  }

  observeHistogram(name: string, value: number): void {
    const hist = this.histograms.get(name);
    if (!hist) return;
    hist.sum += value;
    hist.count++;
    for (let i = 0; i < hist.buckets.length; i++) {
      if (value <= hist.buckets[i]) {
        hist.values[i]++;
        break;
      }
    }
    if (value > hist.buckets[hist.buckets.length - 1]) {
      hist.values[hist.values.length - 1]++;
    }
  }

  getMetrics(): string {
    const lines: string[] = [];
    for (const [name, counters] of this.counters) {
      const registeredHelp = this.counterHelp.get(name) || '';
      for (const c of counters) {
        const help = c.help || registeredHelp;
        if (help) lines.push(`# HELP ${c.name} ${help}`);
        lines.push(`# TYPE ${c.name} counter`);
        const labelStr = this.labelsToString(c.labels);
        if (labelStr) {
          lines.push(`${c.name}{${labelStr}} ${c.value}`);
        } else {
          lines.push(`${c.name} ${c.value}`);
        }
      }
    }
    for (const [, hist] of this.histograms) {
      if (hist.help) lines.push(`# HELP ${hist.name} ${hist.help}`);
      lines.push(`# TYPE ${hist.name} histogram`);
      for (let i = 0; i < hist.buckets.length; i++) {
        lines.push(`${hist.name}_bucket{le="${hist.buckets[i]}"} ${hist.values[i]}`);
      }
      lines.push(`${hist.name}_bucket{le="+Inf"} ${hist.values[hist.values.length - 1]}`);
      lines.push(`${hist.name}_sum ${hist.sum}`);
      lines.push(`${hist.name}_count ${hist.count}`);
    }
    return lines.join('\n');
  }
}

// Singleton instance
export const metricsRegistry = new MetricsRegistry();

// Register default metrics
metricsRegistry.registerCounter('posts_published', 'Total posts published');
metricsRegistry.registerCounter('posts_failed', 'Total posts failed');
metricsRegistry.registerCounter('generation_count', 'Total content generations');
metricsRegistry.registerCounter('tos_blocked', 'Total posts blocked by ToS');
metricsRegistry.registerCounter('relay_cards_sent', 'Total relay cards sent');
metricsRegistry.registerHistogram('publish_latency', 'Post publish latency in seconds');
metricsRegistry.registerHistogram('generation_latency', 'Content generation latency in seconds');
