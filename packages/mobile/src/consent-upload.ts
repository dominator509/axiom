import { consentDocumentUploadType, MAX_CONSENT_DOCUMENT_BYTES } from '@axiom/core';

export interface ConsentUploadDocument {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number;
  /** Present on web; native uses the document picker's temporary URI. */
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
  const size = document.size ?? document.file?.size;
  if (size !== undefined && (!Number.isFinite(size) || size <= 0)) return 'empty';
  if (size !== undefined && size > MAX_CONSENT_DOCUMENT_BYTES) return 'too-large';
  return null;
}

/** Build the existing API multipart contract without serializing file bytes into JSON/base64. */
export function consentRecordUploadFormData(input: ConsentRecordUploadInput): FormData {
  if (validateConsentUploadDocument(input.document) !== null) {
    throw new Error('invalid consent document');
  }
  const form = new FormData();
  form.append('platform', input.platform);
  form.append('docKind', input.docKind);
  form.append('subjectRef', input.subjectRef);
  form.append('validFrom', input.validFrom);
  if (input.validTo) form.append('validTo', input.validTo);
  if (input.expiresAt) form.append('expiresAt', input.expiresAt);
  if (input.document.file) {
    form.append('document', input.document.file, input.document.name);
  } else {
    // React Native's FormData implementation reads a picked file from its URI.
    form.append('document', {
      uri: input.document.uri,
      name: input.document.name,
      type: input.document.mimeType || 'application/octet-stream',
    } as unknown as Blob);
  }
  return form;
}
