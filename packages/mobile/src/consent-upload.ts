import { consentDocumentUploadType, MAX_CONSENT_DOCUMENT_BYTES } from '@axiom/core';

export interface ConsentUploadDocument {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number;
  /** Browser File or an Expo File backed by the picked native URI. */
  file?: Blob | null;
}

export interface ConsentRecordUploadInput {
  platform: string;
  docKind: '2257' | 'model_release' | 'id_verify' | 'platform_consent';
  subjectRef: string;
  validFrom: string;
  validTo?: string;
  expiresAt?: string;
  document: ConsentUploadDocument;
}

export type ConsentDocumentValidation = 'unsupported' | 'empty' | 'too-large' | null;

/** Validate picker metadata before sending; the API independently checks bytes and content. */
export function validateConsentUploadDocument(document: ConsentUploadDocument): ConsentDocumentValidation {
  if (!document.uri || !document.name.trim()
    || !consentDocumentUploadType(document.mimeType ?? '', document.name)) return 'unsupported';
  for (const size of [document.size, document.file?.size]) {
    if (size !== undefined && (!Number.isFinite(size) || size <= 0)) return 'empty';
    if (size !== undefined && size > MAX_CONSENT_DOCUMENT_BYTES) return 'too-large';
  }
  return null;
}

/** Keep native file bytes readable by Expo fetch without creating a plaintext cache copy. */
export async function prepareConsentUploadDocument(document: ConsentUploadDocument): Promise<ConsentUploadDocument> {
  if (validateConsentUploadDocument(document) !== null) throw new Error('invalid consent document');
  if (document.file) return document;
  const { File } = await import('expo-file-system');
  // Content-provider URIs can end in numeric IDs. Preserve the picker filename,
  // including the DNG extension used by the server's MIME fallback.
  class PickedConsentFile extends File {
    override get name(): string { return document.name; }
  }
  const file = new PickedConsentFile(document.uri);
  const prepared = { ...document, file, size: file.size };
  if (validateConsentUploadDocument(prepared) !== null) throw new Error('invalid consent document');
  return prepared;
}

/** Build the existing API multipart contract without serializing file bytes into JSON/base64. */
export function consentRecordUploadFormData(input: ConsentRecordUploadInput): FormData {
  if (!input.document.file || validateConsentUploadDocument(input.document) !== null) {
    throw new Error('invalid consent document');
  }
  const form = new FormData();
  form.append('platform', input.platform);
  form.append('docKind', input.docKind);
  form.append('subjectRef', input.subjectRef);
  form.append('validFrom', input.validFrom);
  if (input.validTo) form.append('validTo', input.validTo);
  if (input.expiresAt) form.append('expiresAt', input.expiresAt);
  form.append('document', input.document.file, input.document.name);
  return form;
}
