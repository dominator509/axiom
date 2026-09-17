import { describe, expect, it } from 'vitest';
import { projectExemplar, type RetrievalRow } from './viral-retrieval.js';

const row: RetrievalRow = {
  id: 'example', modelId: 'source-model', platform: 'instagram', label: 'strong', perfScore: 1.5,
  features: { title: 'Private persona', caption: 'Private character story?', hashtags: ['private-name'], aiNotes: 'Private instructions' },
};

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
