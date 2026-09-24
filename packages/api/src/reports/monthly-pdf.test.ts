import { describe, expect, it } from 'vitest';
import { buildMonthlyReportPdf } from './monthly-pdf.js';

const data = {
  displayName: 'Luna',
  period: '2026-09',
  scheduledPosts: 1200,
  publishedPosts: 1001,
  views: 1234567,
  likes: 2000,
  shares: 300,
  comments: 40,
  adherenceScore: 84,
  viralExemplars: 2,
};

describe('monthly report PDF', () => {
  it('uses the requested locale for labels, month and counts', () => {
    const pdf = new TextDecoder().decode(buildMonthlyReportPdf(data, 'de'));
    expect(pdf).toContain('%PDF-1.4');
    expect(pdf).toContain('/Encoding /UniJIS-UTF16-H');
    expect(pdf).toContain('FEFF004700650070006C0061006E0074006500200042006500690074');
    expect(pdf).toContain('0031002E003200300030');
    expect(pdf).toContain('September 2026');
    expect(pdf).not.toContain('Scheduled posts');
  });

  it('encodes non-ASCII report text as UTF-16BE instead of replacing it', () => {
    const pdf = new TextDecoder().decode(buildMonthlyReportPdf(data, 'ja'));
    expect(pdf).toContain('/Subtype /Type0');
    expect(pdf).toContain('/Encoding /UniJIS-UTF16-H');
    expect(pdf).toContain('<FEFF');
    expect(pdf).not.toContain('????');
  });
});
