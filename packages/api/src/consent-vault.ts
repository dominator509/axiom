import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { MAX_CONSENT_DOCUMENT_BYTES } from '@axiom/core';
import type { ConsentDocumentType } from '@axiom/core';

export { MAX_CONSENT_DOCUMENT_BYTES };
export type { ConsentDocumentType };

const MAGIC = Buffer.from('ACV1');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MIME_EXTENSIONS: Record<ConsentDocumentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'dng',
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
  if (mimeType === 'image/png') return bytes.byteLength >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return matchesDngTiff(bytes);
}

function matchesDngTiff(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!littleEndian && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return false;
  const readU16 = (offset: number) => offset >= 0 && offset + 2 <= bytes.byteLength ? view.getUint16(offset, littleEndian) : null;
  const readU32 = (offset: number) => offset >= 0 && offset + 4 <= bytes.byteLength ? view.getUint32(offset, littleEndian) : null;
  const readU64 = (offset: number) => {
    if (offset < 0 || offset + 8 > bytes.byteLength) return null;
    const value = view.getBigUint64(offset, littleEndian);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  };

  const magic = readU16(2);
  let ifdOffset: number | null;
  let entryCount: number | null;
  let entryOffset: number;
  let entrySize: number;
  let countSize: number;
  let valueOffset: number;
  if (magic === 42) {
    ifdOffset = readU32(4);
    if (ifdOffset === null || ifdOffset < 8) return false;
    entryCount = readU16(ifdOffset);
    entryOffset = ifdOffset + 2;
    entrySize = 12;
    countSize = 4;
    valueOffset = 8;
  } else if (magic === 43) {
    if (readU16(4) !== 8 || readU16(6) !== 0) return false;
    ifdOffset = readU64(8);
    if (ifdOffset === null || ifdOffset < 16) return false;
    entryCount = readU64(ifdOffset);
    entryOffset = ifdOffset + 8;
    entrySize = 20;
    countSize = 8;
    valueOffset = 12;
  } else {
    return false;
  }
  if (entryCount === null || entryCount > Math.floor((bytes.byteLength - entryOffset) / entrySize)) return false;

  for (let index = 0; index < entryCount; index += 1) {
    const current = entryOffset + index * entrySize;
    if (readU16(current) !== 0xc612) continue;
    const type = readU16(current + 2);
    const count = countSize === 4 ? readU32(current + 4) : readU64(current + 4);
    return type === 1 && count === 4 && bytes[current + valueOffset] > 0;
  }
  return false;
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
