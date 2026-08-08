// ─── Publish Input Validation — Vitest Suite ───
// Covers: validatePublish happy path, empty media, unsupported media types,
// media count overflow, caption requirement, caption length, and TosVerdict mapping.

import { describe, it, expect } from 'vitest';
import { validatePublish } from './validation.js';
import type { ConnectorCapability, ConnectorPublishInput } from './types.js';

const cap: ConnectorCapability = {
  publish: true,
  media: ['image', 'video'],
  maxMediaBytes: 10 * 1024 * 1024,
  maxMediaCount: 4,
  caption: true,
  maxCaptionLength: 280,
  scheduling: 'internal',
  metrics: ['likes'],
  refreshMetrics: true,
};

function input(overrides: Partial<ConnectorPublishInput> = {}): ConnectorPublishInput {
  return {
    idempotencyKey: 'k1',
    caption: 'A perfectly fine caption',
    mediaUrls: ['https://cdn.example.com/photo.jpg'],
    ...overrides,
  };
}

describe('validatePublish', () => {
  it('returns valid pass for a well-formed input', () => {
    const report = validatePublish(input(), cap);
    expect(report.valid).toBe(true);
    expect(report.tosVerdict).toBe('pass');
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.infos).toEqual([]);
  });

  it('blocks when mediaUrls is empty', () => {
    const report = validatePublish(input({ mediaUrls: [] }), cap);
    expect(report.valid).toBe(false);
    expect(report.tosVerdict).toBe('block');
    expect(report.errors).toContainEqual({
      field: 'mediaUrls',
      message: 'At least one media URL is required.',
      severity: 'error',
    });
  });

  it('blocks when mediaUrls is undefined', () => {
    const report = validatePublish(input({ mediaUrls: undefined }), cap);
    expect(report.valid).toBe(false);
    expect(report.errors[0].field).toBe('mediaUrls');
  });

  it('blocks when the media count exceeds maxMediaCount', () => {
    const report = validatePublish(
      input({
        mediaUrls: [
          'https://cdn.example.com/1.jpg',
          'https://cdn.example.com/2.jpg',
          'https://cdn.example.com/3.jpg',
          'https://cdn.example.com/4.jpg',
          'https://cdn.example.com/5.jpg',
        ],
      }),
      cap,
    );
    expect(report.valid).toBe(false);
    expect(report.tosVerdict).toBe('block');
    expect(report.errors.some((e) => e.message.includes('Maximum of 4 media items allowed'))).toBe(
      true,
    );
  });

  it('flags unsupported media types as warnings', () => {
    // 'gif' is not in cap.media (['image','video'])
    const report = validatePublish(input({ mediaUrls: ['https://cdn.example.com/anim.gif'] }), cap);
    expect(report.valid).toBe(true);
    expect(report.tosVerdict).toBe('flag');
    expect(report.warnings[0]).toMatchObject({
      field: 'mediaUrls[0]',
      severity: 'warning',
    });
    expect(report.warnings[0].message).toContain('"gif"');
  });

  it('detects video extensions', () => {
    const report = validatePublish(input({ mediaUrls: ['https://cdn.example.com/clip.mp4'] }), cap);
    expect(report.valid).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it('treats unparseable URLs as default image type', () => {
    const report = validatePublish(input({ mediaUrls: ['not a url'] }), cap);
    expect(report.valid).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it('flags a missing caption as a warning when the platform requires one', () => {
    const report = validatePublish(input({ caption: '' }), cap);
    expect(report.valid).toBe(true);
    expect(report.tosVerdict).toBe('flag');
    expect(report.warnings).toContainEqual({
      field: 'caption',
      message: 'This platform recommends including a caption.',
      severity: 'warning',
    });
  });

  it('blocks captions exceeding maxCaptionLength', () => {
    const report = validatePublish(input({ caption: 'x'.repeat(281) }), cap);
    expect(report.valid).toBe(false);
    expect(report.tosVerdict).toBe('block');
    expect(report.errors[0].message).toContain('Caption exceeds maximum length of 280 characters');
  });

  it('does not warn about captions when the platform does not support them', () => {
    const noCaptionCap: ConnectorCapability = { ...cap, caption: false, maxCaptionLength: 0 };
    const report = validatePublish(input({ caption: '' }), noCaptionCap);
    expect(report.valid).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it('returns empty infos in every case', () => {
    const report = validatePublish(input(), cap);
    expect(report.infos).toEqual([]);
  });
});
