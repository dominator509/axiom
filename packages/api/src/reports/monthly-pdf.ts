/**
 * Small dependency-free PDF renderer for the operator's monthly report.
 *
 * This intentionally renders a bounded, text-first artifact from already
 * authenticated analytics data. It keeps report generation available on a
 * self-hosted install without pulling a browser or a PDF runtime into the
 * API process; richer branding can be layered on later without changing the
 * report contract.
 */

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
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString('en-US') : '0';
}

/** Return a valid single-page PDF as bytes. */
export function buildMonthlyReportPdf(data: MonthlyReportData): Uint8Array {
  const lines = [
    'FanThynks · Monthly performance report',
    `${data.displayName} · ${data.period}`,
    '',
    `Scheduled posts: ${formatNumber(data.scheduledPosts)}`,
    `Published posts: ${formatNumber(data.publishedPosts)}`,
    `Views: ${formatNumber(data.views)}`,
    `Likes: ${formatNumber(data.likes)}`,
    `Shares: ${formatNumber(data.shares)}`,
    `Comments: ${formatNumber(data.comments)}`,
    `Course adherence score: ${formatNumber(data.adherenceScore)} / 100`,
    `Viral exemplars captured: ${formatNumber(data.viralExemplars)}`,
    '',
    'Metrics are generated from the authenticated workspace analytics store.',
    'Provider totals are latest snapshots within the selected calendar month.',
  ];

  const commands = ['BT', '/F1 18 Tf', '54 748 Td'];
  lines.forEach((line, index) => {
    if (index === 2) commands.push('/F1 11 Tf');
    if (index > 0) commands.push('0 -24 Td');
    commands.push(`(${pdfText(line)}) Tj`);
  });
  commands.push('ET');
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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
