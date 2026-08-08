export type ViralLabel = 'viral' | 'strong' | 'baseline' | 'weak';

export interface PostMetrics {
  postId: string;
  platform: string;
  modelName: string;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagementRate: number;
  revenue?: number;
  timestamp: number;
}

export interface Exemplar {
  postId: string;
  label: ViralLabel;
  platform: string;
  modelName: string;
  promptInputs: Record<string, unknown>;
  captionStructure: Record<string, unknown>;
  hashtagSet: string[];
  timing: string;
  format: string;
  performance: PostMetrics;
  embedding?: Float32Array;
  timestamp: number;
}

export class ViralLoop {
  private metricsStore: Map<string, PostMetrics> = new Map();
  private exemplars: Exemplar[] = [];
  private thresholds: Map<string, Map<string, { p90: number; p70: number; p30: number }>> =
    new Map();

  ingestMetrics(postId: string, metrics: PostMetrics): void {
    this.metricsStore.set(postId, metrics);
    this.updatePercentiles(metrics.platform, metrics.modelName);
  }

  private updatePercentiles(platform: string, modelName: string): void {
    const platformMetrics = Array.from(this.metricsStore.values())
      .filter((m) => m.platform === platform && m.modelName === modelName)
      .sort((a, b) => a.engagementRate - b.engagementRate);

    if (platformMetrics.length < 4) return;

    const n = platformMetrics.length;
    const p90Idx = Math.floor(n * 0.9);
    const p70Idx = Math.floor(n * 0.7);
    const p30Idx = Math.floor(n * 0.3);

    if (!this.thresholds.has(platform)) {
      this.thresholds.set(platform, new Map());
    }
    this.thresholds.get(platform)!.set(modelName, {
      p90: platformMetrics[p90Idx]?.engagementRate ?? 0,
      p70: platformMetrics[p70Idx]?.engagementRate ?? 0,
      p30: platformMetrics[p30Idx]?.engagementRate ?? 0,
    });
  }

  labelPost(postId: string): ViralLabel {
    const metrics = this.metricsStore.get(postId);
    if (!metrics) return 'baseline';

    const thresholds = this.thresholds.get(metrics.platform)?.get(metrics.modelName);

    if (!thresholds) return 'baseline';

    const er = metrics.engagementRate;
    if (er >= thresholds.p90) return 'viral';
    if (er >= thresholds.p70) return 'strong';
    if (er >= thresholds.p30) return 'baseline';
    return 'weak';
  }

  storeExemplar(postId: string, label: ViralLabel): void {
    const metrics = this.metricsStore.get(postId);
    if (!metrics) return;

    const exemplar: Exemplar = {
      postId,
      label,
      platform: metrics.platform,
      modelName: metrics.modelName,
      promptInputs: {},
      captionStructure: {},
      hashtagSet: [],
      timing: '',
      format: '',
      performance: metrics,
      timestamp: Date.now(),
    };

    this.exemplars.push(exemplar);
  }

  embedFeatures(features: Float32Array): Float32Array {
    // Simple random projection as placeholder
    // In production, this would use a sentence-transformer model
    return features;
  }

  retrieveExemplars(platform: string, limit: number = 10): Exemplar[] {
    return this.exemplars
      .filter((e) => e.platform === platform && (e.label === 'viral' || e.label === 'strong'))
      .sort((a, b) => b.performance.engagementRate - a.performance.engagementRate)
      .slice(0, limit);
  }

  getMetrics(postId: string): PostMetrics | undefined {
    return this.metricsStore.get(postId);
  }

  getExemplarCount(): number {
    return this.exemplars.length;
  }
}
