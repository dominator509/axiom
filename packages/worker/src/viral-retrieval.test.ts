import { describe, expect, it } from 'vitest';
import { diversifyExemplars, projectExemplar, type RetrievalRow, type RankedRow } from './viral-retrieval.js';
import { embedExemplarIntent } from './embedding.js';

const row: RetrievalRow = {
  id: 'example', modelId: 'source-model', platform: 'instagram', label: 'strong', perfScore: 1.5,
  features: { title: 'Private persona', caption: 'Private character story?', hashtags: ['private-name'], aiNotes: 'Private instructions' },
};

describe('intent retrieval ranking', () => {
  const now = Date.parse('2026-09-17T00:00:00Z');
  const candidate = (id: string, text: string, age = 0): RankedRow => ({
    ...row, id, embedding: embedExemplarIntent(text), createdAt: new Date(now - age * 86400_000),
  });
  it('matches shared words instead of requiring identical captions', () => {
    const result = diversifyExemplars([candidate('a', 'sports stadium'), candidate('b', 'ceramic vase blue')], embedExemplarIntent('blue vase'), 1, now);
    expect(result[0].id).toBe('b');
  });
  it('penalizes duplicate guidance and selects a different second example', () => {
    const result = diversifyExemplars([candidate('a', 'blue vase'), candidate('b', 'blue vase'), candidate('c', 'ceramic bowl')], embedExemplarIntent('blue vase'), 2, now);
    expect(result.map(item => item.id)).toEqual(['a', 'c']);
  });
  it('prefers recent guidance at equal relevance and performance', () => {
    const result = diversifyExemplars([candidate('a', 'blue vase', 120), candidate('b', 'blue vase')], embedExemplarIntent('blue vase'), 1, now);
    expect(result[0].id).toBe('b');
  });
  it('does not mutate candidates and handles an empty pool', () => {
    const rows = [candidate('z', 'vase'), candidate('a', 'bowl')];
    diversifyExemplars(rows, embedExemplarIntent('vase'), 2, now);
    expect(rows.map(item => item.id)).toEqual(['z', 'a']);
    expect(diversifyExemplars([], [], 3, now)).toEqual([]);
  });
});

describe('generation exemplar privacy projection', () => {
  it('retains owned copy for the same model', () => {
    expect(projectExemplar(row, row.modelId)).toMatchObject({
      title: 'Private persona', caption: 'Private character story?',
      hashtags: ['private-name'], aiNotes: 'Private instructions',
    });
  });
  it('shares only bounded structural guidance across models', () => {
    const projected = projectExemplar(row, 'other-model');
    expect(projected.caption).toBe('');
    expect(projected.hashtags).toEqual([]);
    expect(projected.aiNotes).toContain('question hook: yes');
    expect(JSON.stringify(projected)).not.toMatch(/Private|private-name/);
  });
  it('ignores malformed feature fields rather than forwarding objects', () => {
    const projected = projectExemplar({ ...row, features: { caption: {}, hashtags: [3, null], title: {}, aiNotes: {} } }, row.modelId);
    expect(projected).toMatchObject({ caption: '', hashtags: [], title: '', aiNotes: null });
  });
});
