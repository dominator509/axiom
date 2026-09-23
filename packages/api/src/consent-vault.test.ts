import { afterEach, describe, expect, it } from 'vitest';
import {
  consentDocumentSha256,
  consentDocumentType,
  matchesConsentDocumentType,
  openConsentDocument,
  sealConsentDocument,
} from './consent-vault.js';

const priorSecret = process.env.BETTER_AUTH_SECRET;
const scope = {
  orgId: '11111111-1111-4111-8111-111111111111',
  modelId: '22222222-2222-4222-8222-222222222222',
  recordId: '33333333-3333-4333-8333-333333333333',
};

afterEach(() => {
  if (priorSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = priorSecret;
});

describe('encrypted consent document vault', () => {
  it('authenticates bytes and tenant/model/record identity', () => {
    process.env.BETTER_AUTH_SECRET = 'consent-vault-test-secret-with-32-bytes-minimum';
    const plaintext = Buffer.from('%PDF-1.7 private consent record');
    const sealed = sealConsentDocument(plaintext, scope);
    expect(sealed.includes(plaintext)).toBe(false);
    expect(openConsentDocument(sealed, scope)).toEqual(plaintext);
    expect(() => openConsentDocument(sealed, { ...scope, orgId: '99999999-9999-4999-8999-999999999999' })).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    expect(() => openConsentDocument(tampered, scope)).toThrow();
    expect(consentDocumentSha256(plaintext)).toHaveLength(32);
  });

  it('fails closed without a stable application encryption secret', () => {
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => sealConsentDocument(Buffer.from('x'), scope)).toThrow('encryption is unavailable');
  });

  it('allows only supported document types whose contents match the claimed type', () => {
    expect(consentDocumentType('application/pdf')).toBe('application/pdf');
    expect(consentDocumentType('image/svg+xml')).toBeNull();
    expect(matchesConsentDocumentType(Buffer.from('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(matchesConsentDocumentType(Buffer.from('<svg/>'), 'application/pdf')).toBe(false);
    expect(matchesConsentDocumentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')).toBe(true);
  });
});
