import { describe, expect, it } from 'vitest';
import {
  isLearningArm,
  isLearningContext,
  learningContextBucket,
  parseLearningArm,
  sanitizeGuidanceEvidence,
  timingBucketForHour,
  validateGuidanceEvidence,
} from './learning-contract.js';

describe('shared learning evidence contract', () => {
  it('preserves legacy arms and parses richer bounded arms', () => {
    expect(parseLearningArm('short:question')).toMatchObject({ version: 'learn-v1', captionLength: 'short' });
    expect(parseLearningArm('v2:medium:statement:hook=bold-claim:format=carousel')).toMatchObject({
      version: 'learn-v2', hookType: 'bold-claim', format: 'carousel',
    });
    expect(parseLearningArm('v2:medium:statement:hook=bold-claim:format=carousel:time=evening')).toMatchObject({
      version: 'learn-v2', hookType: 'bold-claim', format: 'carousel', timingBucket: 'evening',
    });
    expect(isLearningArm('v2:long:question:hook=unknown:format=single')).toBe(true);
    expect(isLearningArm('v2:long:question:hook=unknown:format=single:time=midnight')).toBe(false);
    expect(isLearningArm('v2:long:question:hook=private:format=single')).toBe(false);
  });

  it('accepts both learning context versions and rejects unbounded contexts', () => {
    expect(learningContextBucket('learn-v1:scheduled-utc-3')).toBe(3);
    expect(learningContextBucket('learn-v2:scheduled-utc-unknown')).toBe('unknown');
    expect(isLearningContext('learn-v2:scheduled-utc-4')).toBe(false);
  });

  it('rejects malformed or inconsistent evidence as a whole', () => {
    expect(sanitizeGuidanceEvidence({ hookType: 'question', format: 'single' })).toEqual({ hookType: 'question', format: 'single' });
    expect(sanitizeGuidanceEvidence({ hookType: 'question', format: 'unknown-provider' })).toBeNull();
    expect(sanitizeGuidanceEvidence({ postingHourUtc: 9, timingBucket: 'night' })).toBeNull();
    expect(validateGuidanceEvidence({ postingHourUtc: 9, timingBucket: 'morning' })).toEqual({ ok: true, errors: [] });
  });

  it('keeps the timing vocabulary deterministic', () => {
    expect(timingBucketForHour(0)).toBe('night');
    expect(timingBucketForHour(6)).toBe('morning');
    expect(timingBucketForHour(12)).toBe('afternoon');
    expect(timingBucketForHour(18)).toBe('evening');
  });
});
