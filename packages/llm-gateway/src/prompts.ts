// ─── Master Prompt Engine ───
// TOKENKILLER S0–S3 segment building, prompt assembly, photoshoot prompt generation,
// and CourseAdherenceScore calculator.

// ─── TokenKillerSegments (local definition, mirrors @axiom/fanvue-mcp) ───

export interface TokenKillerSegments {
  /** S0: System persona (static, model-dependent) */
  S0: string;
  /** S1: Playbook / ToS rules (static, per-platform) */
  S1: string;
  /** S2: Viral exemplars (semi-static, retrieved) */
  S2: string;
  /** S3: Task variables (dynamic) */
  S3: string;
}

// ─── 64-Token Block Alignment ───

const CHARS_PER_TOKEN = 4;
const BLOCK_SIZE_TOKENS = 64;

/**
 * Align a text string to a multiple of 64 tokens by padding with spaces.
 * This ensures prefix blocks align with the model's tokenization boundaries,
 * reducing inference variance from token boundary shifts.
 */
export function alignBlocks(text: string): string {
  const estimatedTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
  const remainder = estimatedTokens % BLOCK_SIZE_TOKENS;

  if (remainder === 0) {
    return text;
  }

  const tokensToAdd = BLOCK_SIZE_TOKENS - remainder;
  const charsToAdd = tokensToAdd * CHARS_PER_TOKEN;

  return text + ' '.repeat(charsToAdd);
}

// ─── Platform Type ───

export const PLATFORMS = [
  'instagram',
  'tiktok',
  'x',
  'youtube',
  'facebook',
  'reddit',
  'threads',
  'snapchat',
  'discord',
  'telegram',
  'fanvue',
] as const;

export type Platform = (typeof PLATFORMS)[number];

// ─── Profile / Model types ───

export interface ModelProfile {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  persona?: string;
  characterRules?: string[];
}

export interface PlatformRules {
  description: string;
  blockedKeywords: string[];
  maxHashtags: number;
  maxCaptionLength: number;
  linksAllowed: boolean;
  reviewCategories: string[];
}

export interface ViralExemplar {
  id: string;
  platform: Platform;
  title: string;
  caption: string;
  hashtags: string[];
  viralLabel: 'viral' | 'strong' | 'baseline' | 'weak';
  aiNotes: string | null;
}

export interface TaskVariables {
  modelId: string;
  platform: Platform;
  angle?: string;
  emojiStyle?: 'minimal' | 'moderate' | 'heavy';
  cta?: string;
  talkingPoints?: string[];
  mediaDescriptions?: string[];
  imageCaption?: string;
  [key: string]: unknown;
}

// ─── Platform Rules Map (mirrors fanvue-mcp tos-engine data) ───

const PLATFORM_RULES: Record<Platform, PlatformRules> = {
  instagram: {
    description: 'Instagram Community Guidelines — no nudity, hate speech, harassment',
    blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans'],
    maxHashtags: 30,
    maxCaptionLength: 2200,
    linksAllowed: true,
    reviewCategories: ['suggestive', 'revealing', 'sexual_wellness'],
  },
  tiktok: {
    description: 'TikTok Community Guidelines — no sexually explicit content, adult nudity',
    blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans', 'nsfw'],
    maxHashtags: 20,
    maxCaptionLength: 2200,
    linksAllowed: false,
    reviewCategories: ['suggestive', 'revealing', 'intimate'],
  },
  x: {
    description: 'X/Twitter Rules — no violent content, harassment, adult content (permissive)',
    blockedKeywords: ['violence', 'gore', 'harassment'],
    maxHashtags: 50,
    maxCaptionLength: 4000,
    linksAllowed: true,
    reviewCategories: ['suggestive'],
  },
  youtube: {
    description: 'YouTube Community Guidelines — no nudity, sexual content, harmful content',
    blockedKeywords: [
      'nude',
      'naked',
      'sex',
      'porn',
      'escort',
      'onlyfans',
      'nsfw',
      'violence',
      'gore',
    ],
    maxHashtags: 15,
    maxCaptionLength: 5000,
    linksAllowed: true,
    reviewCategories: ['suggestive', 'revealing', 'sexual_wellness', 'intimate'],
  },
  facebook: {
    description: 'Facebook Community Standards — no nudity, sexual solicitation, hate speech',
    blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans', 'nsfw'],
    maxHashtags: 30,
    maxCaptionLength: 63206,
    linksAllowed: true,
    reviewCategories: ['suggestive', 'revealing', 'sexual_wellness'],
  },
  reddit: {
    description: 'Reddit Content Policy — no harassment, no involuntary pornography',
    blockedKeywords: ['harassment', 'dox', 'gore'],
    maxHashtags: 0,
    maxCaptionLength: 40000,
    linksAllowed: true,
    reviewCategories: ['suggestive'],
  },
  threads: {
    description: 'Threads Guidelines — no nudity, hate speech, harassment',
    blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans', 'nsfw'],
    maxHashtags: 10,
    maxCaptionLength: 500,
    linksAllowed: false,
    reviewCategories: ['suggestive', 'revealing'],
  },
  snapchat: {
    description: 'Snapchat Community Guidelines — no explicit sexual content, no bullying',
    blockedKeywords: ['nude', 'naked', 'sex', 'porn', 'escort', 'onlyfans', 'nsfw', 'harassment'],
    maxHashtags: 0,
    maxCaptionLength: 250,
    linksAllowed: false,
    reviewCategories: ['suggestive', 'revealing', 'intimate'],
  },
  discord: {
    description:
      'Discord Community Guidelines — no hate speech, harassment, explicit content in non-NSFW channels',
    blockedKeywords: ['harassment', 'dox', 'gore'],
    maxHashtags: 0,
    maxCaptionLength: 2000,
    linksAllowed: true,
    reviewCategories: ['suggestive'],
  },
  telegram: {
    description: 'Telegram Terms — no illegal content, spam, copyright infringement',
    blockedKeywords: ['spam', 'scam', 'illegal'],
    maxHashtags: 0,
    maxCaptionLength: 4096,
    linksAllowed: true,
    reviewCategories: [],
  },
  fanvue: {
    description: 'Fanvue ToS — no illegal content, no minors, platform-specific content rules',
    blockedKeywords: ['minor', 'underage', 'illegal'],
    maxHashtags: 50,
    maxCaptionLength: 5000,
    linksAllowed: true,
    reviewCategories: ['extremely_explicit'],
  },
};

// ─── S0: System Persona Segment ───

/**
 * Build the S0 system persona segment from a model profile.
 * Includes model persona description and character consistency rules.
 */
export function buildS0(profile: ModelProfile): string {
  const lines: string[] = [];

  // Persona header
  lines.push(`[SYSTEM PERSONA]`);
  lines.push(`You are ${profile.displayName} (${profile.handle}), a content creator.`);

  if (profile.bio) {
    lines.push(`Bio: ${profile.bio}`);
  }

  // Persona tone direction
  const personaMap: Record<string, string> = {
    professional_friendly:
      'Your tone is professional, friendly, and approachable. You connect with your audience while maintaining a polished brand voice.',
    casual:
      'You speak naturally, like a friend chatting with followers. Keep it real and relatable.',
    hype: 'You are high-energy and enthusiastic. Every post radiates excitement and positivity.',
    educational:
      'You are an expert educator breaking down complex topics into engaging content. Inform and inspire.',
    default: 'You write engaging, authentic content that resonates with your audience.',
  };

  const personaText = profile.persona
    ? (personaMap[profile.persona] ?? personaMap.default)
    : personaMap.default;
  lines.push(personaText);

  // Character consistency rules
  if (profile.characterRules && profile.characterRules.length > 0) {
    lines.push(`\n[CHARACTER CONSISTENCY RULES]`);
    for (const rule of profile.characterRules) {
      lines.push(`- ${rule}`);
    }
  } else {
    lines.push(`\n[CHARACTER CONSISTENCY RULES]`);
    lines.push('- Maintain consistent voice and tone across all posts.');
    lines.push('- Stay true to the persona established above.');
    lines.push('- Avoid contradictions in messaging or brand positioning.');
  }

  return lines.join('\n');
}

// ─── S1: Playbook / ToS Segment ───

/**
 * Build the S1 playbook / ToS segment from platform rules.
 * Includes posting guidelines and ToS thresholds.
 */
export function buildS1(platform: Platform): string {
  const rules = PLATFORM_RULES[platform];
  if (!rules) {
    return `[PLAYBOOK]\nPlatform: ${platform}\nNo specific rules configured.`;
  }

  const lines: string[] = [];
  lines.push(`[PLAYBOOK: ${platform.toUpperCase()}]`);
  lines.push(`Guidelines: ${rules.description}`);
  lines.push(`Max caption length: ${rules.maxCaptionLength} characters`);
  lines.push(`Max hashtags: ${rules.maxHashtags}`);
  lines.push(`Links allowed: ${rules.linksAllowed ? 'Yes' : 'No'}`);

  if (rules.blockedKeywords.length > 0) {
    lines.push(`Blocked keywords: ${rules.blockedKeywords.join(', ')}`);
  }

  if (rules.reviewCategories.length > 0) {
    lines.push(`Content requiring review: ${rules.reviewCategories.join(', ')}`);
  }

  // ToS thresholds
  const thresholdMap: Record<Platform, number> = {
    instagram: 70,
    tiktok: 65,
    x: 75,
    youtube: 60,
    facebook: 70,
    reddit: 65,
    threads: 70,
    snapchat: 60,
    discord: 70,
    telegram: 70,
    fanvue: 80,
  };

  const threshold = thresholdMap[platform] ?? 70;
  lines.push(`\n[TOS THRESHOLDS]`);
  lines.push(`Acceptance threshold: ${threshold}/100`);
  lines.push(`Above threshold + 15 → block`);
  lines.push(`Above threshold → review`);
  lines.push(`Below threshold → pass`);

  return lines.join('\n');
}

// ─── S2: Viral Exemplar Context Segment ───

/**
 * Build the S2 viral exemplar context segment.
 * Provides examples of high-performing content for style reference.
 * Placeholder for P3 retrieval pipeline integration.
 */
export function buildS2(exemplars: ViralExemplar[]): string {
  if (!exemplars || exemplars.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push(`[VIRAL EXEMPLARS]`);
  lines.push(`Reference the following high-performing posts for style and engagement patterns:\n`);

  for (let i = 0; i < Math.min(exemplars.length, 5); i++) {
    const ex = exemplars[i];
    lines.push(`Example ${i + 1}: "${ex.title}" (${ex.viralLabel})`);
    lines.push(`  Caption: ${ex.caption}`);
    if (ex.hashtags.length > 0) {
      lines.push(`  Hashtags: ${ex.hashtags.join(', ')}`);
    }
    if (ex.aiNotes) {
      lines.push(`  Notes: ${ex.aiNotes}`);
    }
    lines.push('');
  }

  lines.push(`[GUIDANCE]`);
  lines.push(`- Emulate the engagement patterns of strong/viral exemplars.`);
  lines.push(`- Adapt the style to the current platform and persona.`);
  lines.push(`- Do not copy content verbatim — use as inspiration.`);

  return lines.join('\n');
}

// ─── S3: Task Segment ───

/**
 * Build the S3 task segment with current task variables and media descriptions.
 */
export function buildS3(task: TaskVariables): string {
  const lines: string[] = [];
  lines.push(`[TASK]`);
  lines.push(`Model ID: ${task.modelId}`);
  lines.push(`Platform: ${task.platform}`);
  lines.push(`Angle: ${task.angle ?? 'default'}`);
  lines.push(`Emoji style: ${task.emojiStyle ?? 'moderate'}`);
  lines.push(`CTA: ${task.cta ?? 'engagement'}`);

  if (task.talkingPoints && task.talkingPoints.length > 0) {
    lines.push(`Talking points: ${task.talkingPoints.join(' | ')}`);
  }

  // Media descriptions
  if (task.mediaDescriptions && task.mediaDescriptions.length > 0) {
    lines.push(`\n[MEDIA]`);
    for (let i = 0; i < task.mediaDescriptions.length; i++) {
      lines.push(`Media ${i + 1}: ${task.mediaDescriptions[i]}`);
    }
  }

  // Optional image caption
  if (task.imageCaption) {
    // Media descriptions are stored with a leading newline for readability,
    // so inspect the trimmed section marker rather than relying on the raw
    // line prefix. Keep one canonical media section in the prompt.
    if (!lines.some((l) => l.trim() === '[MEDIA]')) {
      lines.push(`\n[MEDIA]`);
    }
    lines.push(`Image: ${task.imageCaption}`);
  }

  // Generation instruction
  lines.push(`\n[OUTPUT]`);
  lines.push(
    `Generate a single caption for this platform. Do not include hashtags in the body of the caption.`,
  );

  return lines.join('\n');
}

// ─── Prompt Assembly ───

export interface AssembledPrompt {
  system: string;
  messages: Array<{ role: string; content: string }>;
}

/**
 * Assemble all four TOKENKILLER segments into a single prompt with block alignment.
 * Ordering: S0 (System Persona) → S1 (Playbook/ToS) → S2 (Exemplars) → S3 (Task)
 */
export function assemblePrompt(segments: TokenKillerSegments): string {
  const parts: string[] = [];

  if (segments.S0) {
    parts.push(`[SYSTEM]\n${segments.S0}`);
  }

  if (segments.S1) {
    parts.push(`[PLAYBOOK]\n${segments.S1}`);
  }

  if (segments.S2) {
    parts.push(`[EXEMPLARS]\n${segments.S2}`);
  }

  if (segments.S3) {
    parts.push(`[TASK]\n${segments.S3}`);
  }

  const assembled = parts.join('\n\n');
  return alignBlocks(assembled);
}

// ─── Photoshoot Prompt Auto-Generator ───

export interface PhotoshootConfig {
  modelName: string;
  style: string; // e.g. 'beach', 'studio', 'urban', 'natural', 'luxury'
  outfit: string; // e.g. 'summer dress', 'casual', 'swimwear'
  location: string; // e.g. 'Miami Beach', 'downtown LA', 'studio'
  mood: string; // e.g. 'energetic', 'romantic', 'edgy', 'calm'
  lighting: string; // e.g. 'golden hour', 'soft studio', 'natural'
  aspectRatio: string; // e.g. '4:5', '9:16', '1:1', '16:9'
  platform: Platform;
}

export interface PhotoshootVariant {
  prompt: string;
  caption: string;
  hashtags: string[];
  styleLabel: string;
}

/**
 * Generate 5 photoshoot prompt variants + captions + hashtags from dropdown configs.
 * Returns varied prompt styles (full-body, close-up, candid, editorial, action).
 */
export function generatePhotoshootPrompts(config: PhotoshootConfig): PhotoshootVariant[] {
  const variants: PhotoshootVariant[] = [];
  const basePrompt = `${config.modelName} wearing ${config.outfit} at ${config.location}`;

  const shotTypes = [
    {
      label: 'Full Body',
      composition:
        `full body shot, ${config.mood} mood, ${config.lighting} lighting, ` +
        `${config.style} style, showing the complete outfit and surroundings`,
      promptSuffix: `, full body composition, ${config.aspectRatio} aspect ratio`,
    },
    {
      label: 'Close Up',
      composition:
        `close up portrait, ${config.mood} expression, ${config.lighting} lighting, ` +
        `intimate and detailed, ${config.style} aesthetic`,
      promptSuffix: `, close up portrait, face focused, ${config.aspectRatio} aspect ratio`,
    },
    {
      label: 'Candid',
      composition:
        `candid moment, natural ${config.mood} pose, ${config.lighting} lighting, ` +
        `captured in the moment at ${config.location}, ${config.style} vibe`,
      promptSuffix: `, candid photography style, natural pose, ${config.aspectRatio} aspect ratio`,
    },
    {
      label: 'Editorial',
      composition:
        `editorial fashion shoot, ${config.mood} atmosphere, ${config.lighting} lighting, ` +
        `high fashion ${config.style} styling, magazine quality at ${config.location}`,
      promptSuffix: `, editorial fashion photography, styled shoot, ${config.aspectRatio} aspect ratio`,
    },
    {
      label: 'Action',
      composition:
        `dynamic action shot, ${config.mood} energy, ${config.lighting} lighting, ` +
        `movement and motion at ${config.location}, ${config.style} style`,
      promptSuffix: `, motion capture, dynamic pose, ${config.aspectRatio} aspect ratio`,
    },
  ];

  const captionTemplates = [
    `New look, new vibes. ${config.mood} energy at ${config.location}. ✨`,
    `Feeling ${config.mood} in this ${config.style} moment. 📸`,
    `${config.location} doing its thing. ${config.modelName} in ${config.outfit}. 🔥`,
    `This one's giving ${config.mood} + ${config.style}. What do you think? 💫`,
    `Living for these ${config.style} vibes at ${config.location}. ${config.mood} energy only. ⚡`,
  ];

  const baseHashtags = [
    config.style.toLowerCase().replace(/\s+/g, ''),
    'photoshoot',
    config.location.toLowerCase().replace(/\s+/g, ''),
    'contentcreator',
    'model',
    config.mood.toLowerCase(),
  ];

  for (let i = 0; i < shotTypes.length; i++) {
    const shot = shotTypes[i];
    const prompt =
      `Professional photoshoot: ${basePrompt}, ${shot.composition}${shot.promptSuffix}, ` +
      `high quality, 8K, detailed, professional lighting, sharp focus`;

    const hashtags = [
      ...baseHashtags,
      shot.label.toLowerCase().replace(/\s+/g, ''),
      config.outfit.toLowerCase().replace(/\s+/g, '').replace(/\s+/g, ''),
    ];

    variants.push({
      prompt,
      caption: captionTemplates[i],
      hashtags: [...new Set(hashtags)].slice(0, 20),
      styleLabel: shot.label,
    });
  }

  return variants;
}

// ─── CourseAdherenceScore Calculator ───

export interface CourseAdherenceInput {
  personaConsistency: number; // 0–1 how well the output matches persona
  platformRuleCompliance: number; // 0–1 fraction of platform rules satisfied
  exemplarSimilarity: number; // 0–1 similarity to viral exemplars
  taskAlignment: number; // 0–1 match between output and task requirements
}

export interface CourseAdherenceScore {
  overall: number; // 0–1 weighted composite
  components: {
    persona: number;
    platform: number;
    exemplar: number;
    task: number;
  };
  weights: {
    persona: number;
    platform: number;
    exemplar: number;
    task: number;
  };
  passed: boolean;
  minimumThreshold: number;
}

const DEFAULT_WEIGHTS = {
  persona: 0.35,
  platform: 0.3,
  exemplar: 0.15,
  task: 0.2,
};

const DEFAULT_THRESHOLD = 0.7;

/**
 * Calculate CourseAdherenceScore based on persona consistency, platform rule
 * compliance, exemplar similarity, and task alignment.
 *
 * Returns a weighted composite score (0–1) and pass/fail verdict.
 */
export function calculateCourseAdherence(
  input: CourseAdherenceInput,
  weights?: Partial<typeof DEFAULT_WEIGHTS>,
  minimumThreshold?: number,
): CourseAdherenceScore {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const threshold = minimumThreshold ?? DEFAULT_THRESHOLD;

  const overall =
    w.persona * input.personaConsistency +
    w.platform * input.platformRuleCompliance +
    w.exemplar * input.exemplarSimilarity +
    w.task * input.taskAlignment;

  return {
    overall: Math.round(overall * 1000) / 1000,
    components: {
      persona: input.personaConsistency,
      platform: input.platformRuleCompliance,
      exemplar: input.exemplarSimilarity,
      task: input.taskAlignment,
    },
    weights: w,
    passed: overall >= threshold,
    minimumThreshold: threshold,
  };
}
