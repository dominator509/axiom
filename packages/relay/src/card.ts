// --- Types ---
export interface BundleContent {
  id: string;
  mediaUrls: string[];
  caption: string;
  captionVariants: Record<string, string>;
  hashtagSets: Record<string, string[]>;
  tosScores: Record<string, number>;
  targetPlatforms: string[];
  price?: number;
  scheduleAt?: string;
  promptInputs?: Record<string, unknown>;
}

export interface PlatformVerdict {
  platform: string;
  passed: boolean;
  score: number;
  reason: string;
}

export type CardAction =
  | 'approve'
  | 'approve_all'
  | 'reject'
  | 'edit_caption'
  | 'change_price'
  | 'reschedule'
  | 'regenerate'
  | 'revise'
  | 'hold';

export interface RelayCard {
  bundleId: string;
  mediaPreview: string;
  caption: string;
  captionVariants: Record<string, string>;
  hashtagSets: Record<string, string[]>;
  verdicts: PlatformVerdict[];
  targetPlatforms: string[];
  price?: number;
  scheduleAt?: string;
  actions: CardAction[];
  timestamp: number;
  format: 'html' | 'embed' | 'text';
}

// --- CardRenderer ---
export class CardRenderer {
  renderBundleCard(bundle: BundleContent): RelayCard {
    const verdicts: PlatformVerdict[] = bundle.targetPlatforms.map((platform) => ({
      platform,
      passed: (bundle.tosScores[platform] ?? 1) >= 0.7,
      score: bundle.tosScores[platform] ?? 1,
      reason:
        (bundle.tosScores[platform] ?? 1) >= 0.7
          ? 'ToS check passed'
          : 'ToS check failed — score below threshold',
    }));

    const allPassed = verdicts.every((v) => v.passed);

    const actions: CardAction[] = allPassed
      ? ['approve', 'approve_all', 'edit_caption', 'change_price', 'reschedule', 'reject', 'hold']
      : ['regenerate', 'revise', 'reject', 'hold'];

    return {
      bundleId: bundle.id,
      mediaPreview: bundle.mediaUrls[0] ?? '',
      caption: bundle.caption,
      captionVariants: bundle.captionVariants,
      hashtagSets: bundle.hashtagSets,
      verdicts,
      targetPlatforms: bundle.targetPlatforms,
      price: bundle.price,
      scheduleAt: bundle.scheduleAt,
      actions,
      timestamp: Date.now(),
      format: 'html',
    };
  }

  toHtml(card: RelayCard): string {
    const verdictRows = card.verdicts
      .map(
        (v) =>
          `<b>${v.platform}:</b> ${v.passed ? '✅ PASS' : '❌ FAIL'} (${(v.score * 100).toFixed(0)}%)`,
      )
      .join('\n');
    const hashtagRows = Object.entries(card.hashtagSets)
      .map(([p, tags]) => `<b>${p}:</b> ${tags.slice(0, 5).join(' ')}`)
      .join('\n');
    return [
      `<b>📦 Bundle: ${card.bundleId}</b>`,
      '',
      `<b>Caption:</b> ${card.caption.slice(0, 200)}`,
      '',
      `<b>ToS Verdicts:</b>`,
      verdictRows,
      '',
      `<b>Hashtags:</b>`,
      hashtagRows,
      '',
      card.price ? `<b>Price:</b> $${card.price}` : '',
      card.scheduleAt ? `<b>Scheduled:</b> ${card.scheduleAt}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  toEmbed(card: RelayCard): Record<string, unknown> {
    return {
      title: `📦 Bundle: ${card.bundleId.slice(0, 8)}`,
      description: card.caption.slice(0, 400),
      color: card.verdicts.every((v) => v.passed) ? 0x00ff00 : 0xff0000,
      fields: [
        {
          name: 'ToS Verdicts',
          value: card.verdicts
            .map((v) => `${v.platform}: ${v.passed ? '✅' : '❌'} (${(v.score * 100).toFixed(0)}%)`)
            .join('\n'),
          inline: false,
        },
        {
          name: 'Target Platforms',
          value: card.targetPlatforms.join(', '),
          inline: true,
        },
        ...(card.price ? [{ name: 'Price', value: `$${card.price}`, inline: true }] : []),
        ...(card.scheduleAt ? [{ name: 'Scheduled', value: card.scheduleAt, inline: true }] : []),
      ],
      timestamp: new Date(card.timestamp).toISOString(),
    };
  }

  toText(card: RelayCard): string {
    const lines: string[] = [
      `📦 Bundle: ${card.bundleId}`,
      `Caption: ${card.caption.slice(0, 200)}`,
      '',
      'ToS Verdicts:',
      ...card.verdicts.map(
        (v) => `  ${v.platform}: ${v.passed ? 'PASS' : 'FAIL'} (${(v.score * 100).toFixed(0)}%)`,
      ),
      '',
      'Actions (reply with number):',
      ...card.actions.map((a, i) => `  ${i + 1}. ${a}`),
    ];
    return lines.join('\n');
  }
}
