import { expect, it } from 'vitest';
import { CONSENT_CATALOGS, interpolate, MAX_CONSENT_DOCUMENT_BYTES, type ConsentMessageKey } from '@axiom/core';
import { consentPayload, consentRequestFormData } from './ConsentRecordForm';
function data(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}
it('accepts a bounded supported document and rejects invalid document/date metadata', () => {
  const valid = data({
    platform: 'fanvue',
    docKind: 'model_release',
    subjectRef: 'model-1',
    validFrom: '2026-01-01',
    validTo: '2027-01-01',
    expiresAt: '2026-12-31',
  });
  valid.set('document', new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }), 'release.pdf');
  expect(consentPayload(valid)).toMatchObject({
    platform: 'fanvue',
    validFrom: '2026-01-01',
    expiresAt: '2026-12-31T23:59:59.999Z',
  });
  valid.set('document', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'document.svg');
  expect(() => consentPayload(valid)).toThrow('PDF, JPEG, PNG or DNG');
  valid.set('document', new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }), 'release.pdf');
  valid.set('validTo', '2025-01-01');
  expect(() => consentPayload(valid)).toThrow('date range');
  valid.set('validTo', '2027-01-01');
  valid.set('expiresAt', '2025-12-31');
  expect(() => consentPayload(valid)).toThrow('date range');
});

it('accepts DNG by extension through 25 MiB and rejects larger documents', () => {
  const valid = data({
    platform: 'fanvue',
    docKind: 'id_verify',
    subjectRef: 'model-1',
    validFrom: '2026-01-01',
    validTo: '',
    expiresAt: '',
  });
  valid.set('document', new Blob([new Uint8Array(MAX_CONSENT_DOCUMENT_BYTES)], { type: 'application/octet-stream' }), 'license.dng');
  expect(consentPayload(valid).document.size).toBe(MAX_CONSENT_DOCUMENT_BYTES);

  valid.set('document', new Blob([new Uint8Array(MAX_CONSENT_DOCUMENT_BYTES + 1)], { type: 'application/octet-stream' }), 'license.dng');
  expect(() => consentPayload(valid)).toThrow(CONSENT_CATALOGS.en['consent.invalidDocument']);
});

it('uses the supplied locale for validation feedback', () => {
  const invalid = data({
    platform: '',
    docKind: 'model_release',
    subjectRef: 'model-1',
    validFrom: '2026-01-01',
    validTo: '',
  });
  invalid.set('document', new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }), 'release.pdf');
  const translate = (key: ConsentMessageKey, values?: Record<string, string | number>) =>
    interpolate(CONSENT_CATALOGS.es[key], values);
  expect(() => consentPayload(invalid, translate)).toThrow(
    CONSENT_CATALOGS.es['consent.invalidPlatform'],
  );
});

it('submits normalized expiry dates and omits blank optional dates', () => {
  const input = data({
    platform: 'fanvue',
    docKind: 'model_release',
    subjectRef: 'model-1',
    validFrom: '2026-01-01',
    validTo: '',
    expiresAt: '',
  });
  input.set('document', new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }), 'release.pdf');

  const openEnded = consentRequestFormData(input);
  expect(openEnded.has('validTo')).toBe(false);
  expect(openEnded.has('expiresAt')).toBe(false);

  input.set('validTo', '2027-01-01');
  input.set('expiresAt', '2026-12-31');
  const bounded = consentRequestFormData(input);
  expect(bounded.get('validTo')).toBe('2027-01-01');
  expect(bounded.get('expiresAt')).toBe('2026-12-31T23:59:59.999Z');
});
