import { describe, expect, it } from 'vitest';
import { consentDocumentUploadType, MAX_CONSENT_DOCUMENT_BYTES } from './consent-document.js';

describe('consent document upload contract', () => {
  it('shares a 25 MiB limit between dashboard and API', () => {
    expect(MAX_CONSENT_DOCUMENT_BYTES).toBe(25 * 1024 * 1024);
  });

  it('resolves supported documents and DNG browser metadata safely', () => {
    expect(consentDocumentUploadType('application/pdf', 'release.pdf')).toBe('application/pdf');
    expect(consentDocumentUploadType('image/jpeg', 'front.jpg')).toBe('image/jpeg');
    expect(consentDocumentUploadType('image/png', 'front.png')).toBe('image/png');
    expect(consentDocumentUploadType('application/octet-stream', 'license.DNG')).toBe('image/tiff');
    expect(consentDocumentUploadType('image/x-adobe-dng', 'license.dng')).toBe('image/tiff');
    expect(consentDocumentUploadType('image/dng', 'license.dng')).toBe('image/tiff');
    expect(consentDocumentUploadType('image/tiff', 'scan.tif')).toBeNull();
    expect(consentDocumentUploadType('image/svg+xml', 'drawing.svg')).toBeNull();
  });
});
