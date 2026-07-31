export interface StyleWeight {
  style: string;
  weight: number;
  lastSelected: number;
  selectionCount: number;
}

export interface BanditConfig {
  epsilon: number;
  explorationFloor: number;
  fatigueWindowMs: number;
  fatigueLimit: number;
}

export interface Exemplar {
  postId: string;
  label: string;
  platform: string;
  performance: {
    engagementRate: number;
  };
  captionStructure?: Record<string, unknown>;
  format?: string;
}

export interface SelectedStyle {
  captionStyle: string;
  hook: string;
  timing: string;
  format: string;
  source: 'explore' | 'exploit';
  exemplarId?: string;
}

export class Bandit {
  private weights: Map<string, StyleWeight> = new Map();
  private config: BanditConfig;
  private rng: () => number;

  constructor(config?: Partial<BanditConfig>) {
    this.config = {
      epsilon: config?.epsilon ?? 0.15,
      explorationFloor: config?.explorationFloor ?? 0.05,
      fatigueWindowMs: config?.fatigueWindowMs ?? 3600_000,
      fatigueLimit: config?.fatigueLimit ?? 3,
    };
    this.rng = Math.random;

    // Initialize default styles
    const defaultStyles = [
      'direct_call', 'storytelling', 'educational', 'humorous', 'controversial',
      'emotional', 'trend_jacking', 'behind_scenes', 'testimonial', 'comparison',
    ];
    for (const style of defaultStyles) {
      this.weights.set(style, {
        style,
        weight: 1.0 / defaultStyles.length,
        lastSelected: 0,
        selectionCount: 0,
      });
    }
  }

  selectStyle(exemplars: Exemplar[]): SelectedStyle {
    // Check fatigue: skip styles used too many times recently
    const now = Date.now();
    const available = Array.from(this.weights.values()).filter((w) => {
      const inWindow = now - w.lastSelected < this.config.fatigueWindowMs;
      return !(inWindow && w.selectionCount >= this.config.fatigueLimit);
    });

    if (available.length === 0) {
      // All styles fatigued, reset counters
      for (const w of this.weights.values()) {
        w.selectionCount = 0;
      }
    }

    const active = available.length > 0 ? available : Array.from(this.weights.values());

    // Epsilon-greedy
    const explore = this.rng() < this.config.epsilon;

    let selectedStyle: StyleWeight;

    if (explore) {
      // Explore: pick uniformly
      selectedStyle = active[Math.floor(this.rng() * active.length)];
    } else {
      // Exploit: weighted selection
      const totalWeight = active.reduce((sum, w) => sum + (w.weight + this.config.explorationFloor), 0);
      let roll = this.rng() * totalWeight;
      selectedStyle = active[0];
      for (const w of active) {
        roll -= w.weight + this.config.explorationFloor;
        if (roll <= 0) {
          selectedStyle = w;
          break;
        }
      }
      // Floating-point subtraction can leave a tiny positive remainder when
      // rng() ≈ 1, so the loop above never breaks and would silently fall back
      // to active[0]. In exact arithmetic roll reaches 0 on the last element,
      // so select it explicitly as the fallback.
      if (roll > 0) {
        selectedStyle = active[active.length - 1];
      }
    }

    selectedStyle.lastSelected = now;
    selectedStyle.selectionCount++;

    // Extract features from best exemplar of this platform
    const bestExemplar = exemplars.length > 0
      ? exemplars.reduce((best, e) =>
          e.performance.engagementRate > best.performance.engagementRate ? e : best
        )
      : undefined;

    return {
      captionStyle: selectedStyle.style,
      hook: this.pickHook(selectedStyle.style),
      timing: this.pickTiming(exemplars),
      format: bestExemplar?.format ?? 'carousel',
      source: explore ? 'explore' : 'exploit',
      exemplarId: bestExemplar?.postId,
    };
  }

  updateReward(style: string, performance: number): void {
    const w = this.weights.get(style);
    if (!w) return;

    // Exponential moving average update
    const alpha = 0.1;
    w.weight = w.weight * (1 - alpha) + performance * alpha;

    // Normalize all weights
    const total = Array.from(this.weights.values()).reduce((sum, wt) => sum + wt.weight, 0);
    for (const wt of this.weights.values()) {
      wt.weight = wt.weight / total;
    }
  }

  getWeights(): Map<string, StyleWeight> {
    // Return a deep copy so callers cannot mutate internal selection state
    return new Map(Array.from(this.weights, ([style, w]) => [style, { ...w }]));
  }

  resetWeights(): void {
    const count = this.weights.size;
    for (const w of this.weights.values()) {
      w.weight = 1.0 / count;
      w.selectionCount = 0;
      w.lastSelected = 0;
    }
  }

  private pickHook(style: string): string {
    const hooks: Record<string, string[]> = {
      direct_call: ['Try this now', "Don't miss out", 'Limited time'],
      storytelling: ['Let me tell you', 'Picture this', 'So there I was'],
      educational: ['Did you know', 'Here is how', 'The truth about'],
      humorous: ['Wait for it', 'This is too good', 'You will laugh'],
      controversial: ['Hot take', 'Unpopular opinion', 'Change my mind'],
      emotional: ['This hit different', 'Heartwarming', 'Absolutely gutted'],
      trend_jacking: ['Everyone is talking about', 'The latest trend'],
      behind_scenes: ['Behind the curtain', 'How it is made', 'The process'],
      testimonial: ['Real talk', 'Honest review', 'Game changer'],
      comparison: ['vs', 'Better than', 'Side by side'],
    };
    const styleHooks = hooks[style] ?? ['Check this out'];
    return styleHooks[Math.floor(this.rng() * styleHooks.length)];
  }

  private pickTiming(exemplars: Exemplar[]): string {
    if (exemplars.length === 0) return '12:00';
    // Pick most common timing from top performers
    const timingCounts = new Map<string, number>();
    for (const e of exemplars.slice(0, 20)) {
      const timing = e.performance?.engagementRate > 0.05 ? 'peak' : 'off-peak';
      timingCounts.set(timing, (timingCounts.get(timing) ?? 0) + 1);
    }
    let bestTiming = '12:00';
    let bestCount = 0;
    for (const [timing, count] of timingCounts) {
      if (count > bestCount) {
        bestTiming = timing;
        bestCount = count;
      }
    }
    return bestTiming;
  }
}
