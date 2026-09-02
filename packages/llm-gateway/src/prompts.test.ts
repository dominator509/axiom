// ─── Master Prompt Engine (TOKENKILLER S0-S3) — Vitest Suite ───
import { describe, it, expect } from 'vitest';
import {
  alignBlocks,
  buildS0,
  buildS1,
  buildS2,
  buildS3,
  assemblePrompt,
  generatePhotoshootPrompts,
  calculateCourseAdherence,
  type ModelProfile,
  type ViralExemplar,
  type TaskVariables,
  type PhotoshootConfig,
} from './prompts.js';

const baseProfile: ModelProfile = {
  id: 'model-1',
  displayName: 'Alex Nova',
  handle: 'alexnova',
  avatarUrl: null,
  bio: 'Fitness and lifestyle creator',
};

describe('alignBlocks', () => {
  it('returns text unchanged when aligned', () => {
    expect(alignBlocks('x'.repeat(256))).toBe('x'.repeat(256));
  });

  it('pads to next multiple of 64 tokens', () => {
    const out = alignBlocks('a'.repeat(252));
    expect(out.length).toBe(256);
    expect(out.endsWith('    ')).toBe(true);
  });

  it('empty string stays empty', () => {
    expect(alignBlocks('')).toBe('');
  });
});

describe('buildS0', () => {
  it('includes persona header with display name and handle', () => {
    const s0 = buildS0(baseProfile);
    expect(s0).toContain('[SYSTEM PERSONA]');
    expect(s0).toContain('You are Alex Nova (alexnova), a content creator.');
  });

  it('includes bio when present', () => {
    expect(buildS0(baseProfile)).toContain('Bio: Fitness and lifestyle creator');
  });

  it('omits bio line when bio is null', () => {
    const s0 = buildS0({ ...baseProfile, bio: null });
    expect(s0).not.toContain('Bio:');
  });

  it('maps known persona styles to their tone text', () => {
    const s0 = buildS0({ ...baseProfile, persona: 'hype' });
    expect(s0).toContain('high-energy and enthusiastic');
  });

  it('falls back to default tone for unknown persona', () => {
    const s0 = buildS0({ ...baseProfile, persona: 'mystery' as never });
    expect(s0).toContain('engaging, authentic content');
  });

  it('uses default tone when persona is undefined', () => {
    expect(buildS0(baseProfile)).toContain('engaging, authentic content');
  });

  it('lists custom character rules when provided', () => {
    const s0 = buildS0({
      ...baseProfile,
      characterRules: ['Never break character.', 'Stay on-brand.'],
    });
    expect(s0).toContain('[CHARACTER CONSISTENCY RULES]');
    expect(s0).toContain('- Never break character.');
    expect(s0).toContain('- Stay on-brand.');
  });

  it('emits default character rules when none provided', () => {
    const s0 = buildS0(baseProfile);
    expect(s0).toContain('[CHARACTER CONSISTENCY RULES]');
    expect(s0).toContain('- Maintain consistent voice and tone across all posts.');
    expect(s0).toContain('- Avoid contradictions in messaging or brand positioning.');
  });
});

describe('buildS1', () => {
  it('builds instagram playbook with rules and thresholds', () => {
    const s1 = buildS1('instagram');
    expect(s1).toContain('[PLAYBOOK: INSTAGRAM]');
    expect(s1).toContain('Guidelines: Instagram Community Guidelines');
    expect(s1).toContain('Max caption length: 2200 characters');
    expect(s1).toContain('Max hashtags: 30');
    expect(s1).toContain('Links allowed: Yes');
    expect(s1).toContain('Blocked keywords: nude, naked, sex, porn, escort, onlyfans');
    expect(s1).toContain('Content requiring review: suggestive, revealing, sexual_wellness');
    expect(s1).toContain('[TOS THRESHOLDS]');
    expect(s1).toContain('Acceptance threshold: 70/100');
    expect(s1).toContain('Above threshold + 15 → block');
    expect(s1).toContain('Above threshold → review');
    expect(s1).toContain('Below threshold → pass');
  });

  it('says links not allowed for tiktok', () => {
    expect(buildS1('tiktok')).toContain('Links allowed: No');
  });

  it('omits review categories line when the platform has none (telegram)', () => {
    const s1 = buildS1('telegram');
    expect(s1).not.toContain('Content requiring review');
    expect(s1).toContain('Acceptance threshold: 70/100');
  });

  it('includes a blocked keywords line for every configured platform', () => {
    // NOTE: every platform in PLATFORM_RULES has a non-empty blockedKeywords
    // list, so the `length > 0` branch in buildS1 is always taken. The
    // "no keywords" branch is effectively dead code.
    const platforms = [
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
    for (const p of platforms) {
      expect(buildS1(p)).toContain('Blocked keywords:');
    }
  });

  it('uses per-platform thresholds', () => {
    expect(buildS1('fanvue')).toContain('Acceptance threshold: 80/100');
    expect(buildS1('youtube')).toContain('Acceptance threshold: 60/100');
    expect(buildS1('x')).toContain('Acceptance threshold: 75/100');
    expect(buildS1('snapchat')).toContain('Acceptance threshold: 60/100');
  });

  it('handles unknown platform gracefully', () => {
    const s1 = buildS1('myspace' as never);
    expect(s1).toContain('[PLAYBOOK]');
    expect(s1).toContain('No specific rules configured.');
  });

  it('covers every platform in the rules map with required fields', () => {
    const platforms = [
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
    for (const p of platforms) {
      const s1 = buildS1(p);
      expect(s1).toContain(`[PLAYBOOK: ${p.toUpperCase()}]`);
      expect(s1).toMatch(/Max caption length: \d+ characters/);
      expect(s1).toMatch(/Max hashtags: \d+/);
      expect(s1).toMatch(/Links allowed: (Yes|No)/);
      expect(s1).toMatch(/Acceptance threshold: \d+\/100/);
    }
  });
});

describe('buildS2', () => {
  const exemplar: ViralExemplar = {
    id: 'ex-1',
    platform: 'instagram',
    title: 'Summer Glow Routine',
    caption: 'My go-to glow up routine',
    hashtags: ['#glow', '#summer'],
    viralLabel: 'viral',
    aiNotes: 'High save rate in first hour',
  };

  it('returns empty string for empty or null exemplar list', () => {
    expect(buildS2([])).toBe('');
    expect(buildS2(null as never)).toBe('');
  });

  it('renders exemplar details including notes and hashtags', () => {
    const s2 = buildS2([exemplar]);
    expect(s2).toContain('[VIRAL EXEMPLARS]');
    expect(s2).toContain('Example 1: "Summer Glow Routine" (viral)');
    expect(s2).toContain('Caption: My go-to glow up routine');
    expect(s2).toContain('Hashtags: #glow, #summer');
    expect(s2).toContain('Notes: High save rate in first hour');
    expect(s2).toContain('[GUIDANCE]');
    expect(s2).toContain('Do not copy content verbatim');
  });

  it('caps at 5 exemplars even when more are passed', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...exemplar,
      id: `ex-${i}`,
      title: `Title ${i}`,
    }));
    const s2 = buildS2(many);
    expect(s2).toContain('Example 5:');
    expect(s2).not.toContain('Example 6:');
  });

  it('omits hashtags and notes lines when absent', () => {
    const s2 = buildS2([{ ...exemplar, hashtags: [], aiNotes: null }]);
    expect(s2).not.toContain('Hashtags:');
    expect(s2).not.toContain('Notes:');
  });
});

describe('buildS3', () => {
  const task: TaskVariables = { modelId: 'model-1', platform: 'instagram' };

  it('uses defaults for missing angle, emojiStyle and cta', () => {
    const s3 = buildS3(task);
    expect(s3).toContain('[TASK]');
    expect(s3).toContain('Model ID: model-1');
    expect(s3).toContain('Platform: instagram');
    expect(s3).toContain('Angle: default');
    expect(s3).toContain('Emoji style: moderate');
    expect(s3).toContain('CTA: engagement');
    expect(s3).toContain('[OUTPUT]');
    expect(s3).toContain('Generate a single caption for this platform.');
  });

  it('renders explicit task variables', () => {
    const s3 = buildS3({
      ...task,
      angle: 'fitness',
      emojiStyle: 'heavy',
      cta: 'follow',
      talkingPoints: ['protein', 'hydration'],
    });
    expect(s3).toContain('Angle: fitness');
    expect(s3).toContain('Emoji style: heavy');
    expect(s3).toContain('CTA: follow');
    expect(s3).toContain('Talking points: protein | hydration');
  });

  it('renders media descriptions under a [MEDIA] header', () => {
    const s3 = buildS3({ ...task, mediaDescriptions: ['gym mirror selfie', 'protein shake'] });
    expect(s3).toContain('[MEDIA]');
    expect(s3).toContain('Media 1: gym mirror selfie');
    expect(s3).toContain('Media 2: protein shake');
  });

  it('renders image caption with a single [MEDIA] header', () => {
    const s3 = buildS3({ ...task, imageCaption: 'golden hour beach shot' });
    expect(s3).toContain('[MEDIA]');
    expect(s3).toContain('Image: golden hour beach shot');
    expect(s3.match(/\[MEDIA\]/g)?.length).toBe(1);
  });

  it('keeps one [MEDIA] header when both media and image caption are present', () => {
    const s3 = buildS3({ ...task, mediaDescriptions: ['clip 1'], imageCaption: 'cover photo' });
    expect(s3.match(/\[MEDIA\]/g)?.length).toBe(1);
    expect(s3).toContain('Media 1: clip 1');
    expect(s3).toContain('Image: cover photo');
  });

  it('omits [MEDIA] entirely when no media info given', () => {
    expect(buildS3(task)).not.toContain('[MEDIA]');
  });
});

describe('assemblePrompt', () => {
  const segments = {
    S0: 'persona-segment',
    S1: 'playbook-segment',
    S2: 'exemplar-segment',
    S3: 'task-segment',
  };

  it('assembles all segments in S0->S3 order with section headers', () => {
    const out = assemblePrompt(segments);
    const s0 = out.indexOf('[SYSTEM]\npersona-segment');
    const s1 = out.indexOf('[PLAYBOOK]\nplaybook-segment');
    const s2 = out.indexOf('[EXEMPLARS]\nexemplar-segment');
    const s3 = out.indexOf('[TASK]\ntask-segment');
    expect(s0).toBeGreaterThanOrEqual(0);
    expect(s1).toBeGreaterThan(s0);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });

  it('joins segments with blank lines', () => {
    expect(assemblePrompt(segments)).toContain('persona-segment\n\n[PLAYBOOK]');
  });

  it('applies block alignment to the assembled text', () => {
    const out = assemblePrompt(segments);
    expect(Math.ceil(out.length / 4) % 64).toBe(0);
  });

  it('skips empty segments', () => {
    const out = assemblePrompt({ S0: 'only', S1: '', S2: '', S3: '' });
    expect(out).toContain('[SYSTEM]\nonly');
    expect(out).not.toContain('[PLAYBOOK]');
    expect(out).not.toContain('[EXEMPLARS]');
    expect(out).not.toContain('[TASK]');
  });

  it('handles all-empty segments', () => {
    const out = assemblePrompt({ S0: '', S1: '', S2: '', S3: '' });
    expect(out).toBe('');
  });
});

describe('generatePhotoshootPrompts', () => {
  const config: PhotoshootConfig = {
    modelName: 'Alex Nova',
    style: 'beach',
    outfit: 'summer dress',
    location: 'Miami Beach',
    mood: 'energetic',
    lighting: 'golden hour',
    aspectRatio: '4:5',
    platform: 'instagram',
  };

  it('generates exactly 5 variants with the expected style labels', () => {
    const variants = generatePhotoshootPrompts(config);
    expect(variants).toHaveLength(5);
    expect(variants.map((v) => v.styleLabel)).toEqual([
      'Full Body',
      'Close Up',
      'Candid',
      'Editorial',
      'Action',
    ]);
  });

  it('includes base prompt, composition and quality suffix in every prompt', () => {
    for (const v of generatePhotoshootPrompts(config)) {
      expect(v.prompt).toContain('Professional photoshoot:');
      expect(v.prompt).toContain('Alex Nova wearing summer dress at Miami Beach');
      expect(v.prompt).toContain('golden hour lighting');
      expect(v.prompt).toContain('4:5 aspect ratio');
      expect(v.prompt).toContain('8K');
      expect(v.prompt).toContain('sharp focus');
    }
  });

  it('captions reference mood, location, style and model', () => {
    const variants = generatePhotoshootPrompts(config);
    expect(variants[0].caption).toContain('energetic');
    expect(variants[0].caption).toContain('Miami Beach');
    expect(variants[3].caption).toContain('beach');
    expect(variants[2].caption).toContain('Alex Nova');
    expect(variants[2].caption).toContain('summer dress');
  });

  it('builds slugged hashtags from style/location/mood/outfit and dedupes', () => {
    const variants = generatePhotoshootPrompts(config);
    for (const v of variants) {
      expect(v.hashtags).toContain('beach');
      expect(v.hashtags).toContain('photoshoot');
      expect(v.hashtags).toContain('miamibeach');
      expect(v.hashtags).toContain('contentcreator');
      expect(v.hashtags).toContain('model');
      expect(v.hashtags).toContain('energetic');
      expect(v.hashtags).toContain('summerdress');
      expect(new Set(v.hashtags).size).toBe(v.hashtags.length);
      expect(v.hashtags.length).toBeLessThanOrEqual(20);
    }
  });

  it('includes the shot-specific label slug in hashtags', () => {
    const variants = generatePhotoshootPrompts(config);
    expect(variants[0].hashtags).toContain('fullbody');
    expect(variants[1].hashtags).toContain('closeup');
    expect(variants[4].hashtags).toContain('action');
  });

  it('handles multi-word style by collapsing spaces in hashtags', () => {
    const variants = generatePhotoshootPrompts({ ...config, style: 'golden hour' });
    expect(variants[0].hashtags).toContain('goldenhour');
  });

  it('keeps prompts distinct across variants', () => {
    const prompts = generatePhotoshootPrompts(config).map((v) => v.prompt);
    expect(new Set(prompts).size).toBe(5);
  });
});

describe('calculateCourseAdherence', () => {
  it('computes the weighted composite with default weights', () => {
    const score = calculateCourseAdherence({
      personaConsistency: 1,
      platformRuleCompliance: 0.5,
      exemplarSimilarity: 0,
      taskAlignment: 1,
    });
    // 0.35*1 + 0.30*0.5 + 0.15*0 + 0.20*1 = 0.70
    expect(score.overall).toBe(0.7);
    expect(score.components).toEqual({
      persona: 1,
      platform: 0.5,
      exemplar: 0,
      task: 1,
    });
    expect(score.weights).toEqual({
      persona: 0.35,
      platform: 0.3,
      exemplar: 0.15,
      task: 0.2,
    });
    expect(score.passed).toBe(true);
    expect(score.minimumThreshold).toBe(0.7);
  });

  it('fails when below default threshold', () => {
    const score = calculateCourseAdherence({
      personaConsistency: 0.5,
      platformRuleCompliance: 0.5,
      exemplarSimilarity: 0.5,
      taskAlignment: 0.5,
    });
    expect(score.overall).toBe(0.5);
    expect(score.passed).toBe(false);
  });

  it('passes exactly at threshold', () => {
    const score = calculateCourseAdherence({
      personaConsistency: 1,
      platformRuleCompliance: 1,
      exemplarSimilarity: 1,
      taskAlignment: 1,
    });
    expect(score.overall).toBe(1);
    expect(score.passed).toBe(true);
  });

  it('respects custom weights', () => {
    const score = calculateCourseAdherence(
      { personaConsistency: 1, platformRuleCompliance: 0, exemplarSimilarity: 0, taskAlignment: 0 },
      { persona: 0.5, platform: 0.5, exemplar: 0, task: 0 },
    );
    expect(score.overall).toBe(0.5);
    expect(score.weights.persona).toBe(0.5);
  });

  it('merges partial weights with defaults', () => {
    const score = calculateCourseAdherence(
      { personaConsistency: 1, platformRuleCompliance: 1, exemplarSimilarity: 1, taskAlignment: 1 },
      { task: 0.5 },
    );
    // 0.35 + 0.30 + 0.15 + 0.50 = 1.30 -> clamped? no — raw composite
    expect(score.overall).toBe(1.3);
    expect(score.weights.task).toBe(0.5);
    expect(score.weights.persona).toBe(0.35);
  });

  it('respects custom minimum threshold', () => {
    const score = calculateCourseAdherence(
      {
        personaConsistency: 0.6,
        platformRuleCompliance: 0.6,
        exemplarSimilarity: 0.6,
        taskAlignment: 0.6,
      },
      undefined,
      0.5,
    );
    expect(score.minimumThreshold).toBe(0.5);
    expect(score.passed).toBe(true);
  });

  it('rounds the overall score to 3 decimal places', () => {
    const score = calculateCourseAdherence({
      personaConsistency: 0.3333333,
      platformRuleCompliance: 0.3333333,
      exemplarSimilarity: 0.3333333,
      taskAlignment: 0.3333333,
    });
    // 0.35*0.3333333 + 0.30*0.3333333 + 0.15*0.3333333 + 0.20*0.3333333 = 0.3333333
    expect(score.overall).toBe(0.333);
  });
});
