import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('ACV1');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export const MAX_CONSENT_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type ConsentDocumentType = 'application/pdf' | 'image/jpeg' | 'image/png';

const MIME_EXTENSIONS: Record<ConsentDocumentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

function vaultKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('Consent document encryption is unavailable');
  return createHash('sha256').update('axiom-consent-vault-v1\0').update(secret).digest();
}

function aad(scope: { orgId: string; modelId: string; recordId: string }): Buffer {
  return Buffer.from(JSON.stringify([scope.orgId, scope.modelId, scope.recordId]), 'utf8');
}

export function consentDocumentType(value: string): ConsentDocumentType | null {
  return Object.hasOwn(MIME_EXTENSIONS, value) ? value as ConsentDocumentType : null;
}

export function consentDocumentExtension(mimeType: ConsentDocumentType): string {
  return MIME_EXTENSIONS[mimeType];
}

export function matchesConsentDocumentType(bytes: Uint8Array, mimeType: ConsentDocumentType): boolean {
  if (mimeType === 'application/pdf') return bytes.byteLength >= 5 && Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from('%PDF-'));
  if (mimeType === 'image/jpeg') return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.byteLength >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

export function consentDocumentSha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/** Authenticated encryption bound to the tenant, model and consent record. */
export function sealConsentDocument(bytes: Uint8Array, scope: { orgId: string; modelId: string; recordId: string }): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', vaultKey(), nonce);
  cipher.setAAD(aad(scope));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), encrypted]);
}

export function openConsentDocument(envelope: Uint8Array, scope: { orgId: string; modelId: string; recordId: string }): Buffer {
  const bytes = Buffer.from(envelope);
  if (bytes.byteLength < MAGIC.byteLength + NONCE_BYTES + TAG_BYTES + 1 || !bytes.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new Error('Consent document record is invalid');
  }
  const nonceStart = MAGIC.byteLength;
  const tagStart = nonceStart + NONCE_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv('aes-256-gcm', vaultKey(), bytes.subarray(nonceStart, tagStart));
  decipher.setAAD(aad(scope));
  decipher.setAuthTag(bytes.subarray(tagStart, ciphertextStart));
  return Buffer.concat([decipher.update(bytes.subarray(ciphertextStart)), decipher.final()]);
}
