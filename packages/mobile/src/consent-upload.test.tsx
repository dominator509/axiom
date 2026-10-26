import { expect, it } from 'vitest';
import { MAX_CONSENT_DOCUMENT_BYTES } from '@axiom/core';
import { consentRecordUploadFormData, prepareConsentUploadDocument, validateConsentUploadDocument } from './consent-upload';

const picked = (overrides: Record<string, unknown> = {}) => ({
  uri: 'file:///private/license.dng',
  name: 'license.dng',
  mimeType: 'application/octet-stream',
  size: MAX_CONSENT_DOCUMENT_BYTES,
  ...overrides,
});

it('accepts DNG at the 25 MiB boundary and rejects oversized or unsupported picker results', () => {
  expect(validateConsentUploadDocument(picked())).toBeNull();
  expect(validateConsentUploadDocument(picked({ size: MAX_CONSENT_DOCUMENT_BYTES + 1 }))).toBe('too-large');
  expect(validateConsentUploadDocument(picked({ name: 'license.tiff', mimeType: 'image/tiff' }))).toBe('unsupported');
  expect(validateConsentUploadDocument(picked({ size: 0 }))).toBe('empty');
});

it('builds multipart metadata and attaches web document bytes under the original DNG name', () => {
  const document = new Blob(['synthetic bytes'], { type: 'application/octet-stream' });
  const form = consentRecordUploadFormData({
    platform: 'instagram',
    docKind: 'id_verify',
    subjectRef: 'subject-test-1',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    expiresAt: '2026-12-31T23:59:59.999Z',
    document: { ...picked(), file: document },
  });

  expect(form.get('platform')).toBe('instagram');
  expect(form.get('docKind')).toBe('id_verify');
  expect(form.get('subjectRef')).toBe('subject-test-1');
  expect(form.get('validFrom')).toBe('2026-01-01');
  expect(form.get('validTo')).toBe('2026-12-31');
  expect(form.get('expiresAt')).toBe('2026-12-31T23:59:59.999Z');
  expect((form.get('document') as File).name).toBe('license.dng');
});

it('rejects a legacy URI-only multipart attachment instead of sending an unsupported native part', () => {
  expect(() => consentRecordUploadFormData({
    platform: 'instagram', docKind: 'id_verify', subjectRef: 'subject-test', validFrom: '2026-01-01',
    document: picked(),
  })).toThrow('invalid consent document');
});

it('checks actual attachment size even when picker metadata understates it', async () => {
  const oversized = new Blob([new Uint8Array(MAX_CONSENT_DOCUMENT_BYTES + 1)]);
  const document = picked({ size: 1, file: oversized });
  expect(validateConsentUploadDocument(document)).toBe('too-large');
  await expect(prepareConsentUploadDocument(document)).rejects.toThrow('invalid consent document');
  expect(validateConsentUploadDocument(picked({ size: 10, file: new Blob([]) }))).toBe('empty');
});

it('preserves real browser File bytes and names through preparation and multipart serialization', async () => {
  const file = new File(['synthetic DNG bytes'], 'original.dng', { type: 'application/octet-stream' });
  const document = await prepareConsentUploadDocument({ ...picked(), size: file.size, file });
  expect(document.file).toBe(file);
  const form = consentRecordUploadFormData({
    platform: 'instagram', docKind: 'id_verify', subjectRef: 'subject-test', validFrom: '2026-01-01', document,
  });
  const response = new Response(form);
  const parsed = await response.formData();
  // The Node test runtime implements get(); React Native's Response type omits it.
  const uploaded = (parsed as unknown as { get(name: string): File }).get('document');
  expect(uploaded.name).toBe('license.dng');
  expect(await uploaded.text()).toBe('synthetic DNG bytes');
});
