/**
 * Small dependency-free PDF renderer for the operator's monthly report.
 *
 * This intentionally renders a bounded, text-first artifact from already
 * authenticated analytics data. It keeps report generation available on a
 * self-hosted install without pulling a browser or a PDF runtime into the
 * API process; richer branding can be layered on later without changing the
 * report contract.
 */

import { CATALOGS, LocaleCatalog, formatDate, formatNumber, type SupportedLocale } from '@axiom/core';

const catalog = new LocaleCatalog(CATALOGS);

export interface MonthlyReportData {
  displayName: string;
  period: string;
  scheduledPosts: number;
  publishedPosts: number;
  views: number;
  likes: number;
  shares: number;
  comments: number;
  adherenceScore: number;
  viralExemplars: number;
}

function pdfText(value: string): string {
  const normalized = value.normalize('NFC');
  if (/^[\x20-\x7E]*$/.test(normalized)) {
    return `(${normalized.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
  }

  // Type-0 fonts consume UTF-16BE strings. Keep the BOM so viewers do not
  // guess a legacy encoding and silently replace Japanese or accented text.
  let hex = 'FEFF';
  for (let index = 0; index < normalized.length; index += 1) {
    const codeUnit = normalized.charCodeAt(index);
    hex += codeUnit.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

function reportCount(value: number, locale: SupportedLocale): string {
  return formatNumber(Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0, locale);
}

/** Return a valid single-page PDF as bytes. */
export function buildMonthlyReportPdf(data: MonthlyReportData, locale: SupportedLocale = 'en'): Uint8Array {
  const t = (key: string, values?: Record<string, string | number>): string => catalog.t(locale, key, values);
  const periodDate = new Date(`${data.period}-01T00:00:00.000Z`);
  const period = Number.isNaN(periodDate.getTime())
    ? data.period
    : formatDate(periodDate, locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lines = [
    t('monthlyReport.title'),
    `${data.displayName} - ${period}`,
    '',
    t('monthlyReport.scheduledPosts', { count: reportCount(data.scheduledPosts, locale) }),
    t('monthlyReport.publishedPosts', { count: reportCount(data.publishedPosts, locale) }),
    t('monthlyReport.views', { count: reportCount(data.views, locale) }),
    t('monthlyReport.likes', { count: reportCount(data.likes, locale) }),
    t('monthlyReport.shares', { count: reportCount(data.shares, locale) }),
    t('monthlyReport.comments', { count: reportCount(data.comments, locale) }),
    t('monthlyReport.adherenceScore', { count: reportCount(data.adherenceScore, locale) }),
    t('monthlyReport.viralExemplars', { count: reportCount(data.viralExemplars, locale) }),
    '',
    t('monthlyReport.source'),
    t('monthlyReport.latestSnapshot'),
    t('monthlyReport.cumulative'),
    t('monthlyReport.savedObservations'),
  ];

  const commands = ['BT', '54 748 Td'];
  lines.forEach((line, index) => {
    const text = pdfText(line);
    const font = text.startsWith('<') ? 'F2' : 'F1';
    commands.push(`/${font} ${index === 0 ? 18 : 11} Tf`);
    if (index > 0) commands.push('0 -24 Td');
    commands.push(`${text} Tj`);
  });
  commands.push('ET');
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UTF16-H /DescendantFonts [7 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /DW 1000 >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
