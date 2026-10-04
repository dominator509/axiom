export const MAX_CONSENT_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type ConsentDocumentType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/tiff';

/** Resolve browser MIME metadata to a supported type. DNG contents are verified by the API. */
export function consentDocumentUploadType(mimeType: string, fileName: string): ConsentDocumentType | null {
  const normalizedType = mimeType.split(';', 1)[0].trim().toLowerCase();
  const normalizedName = fileName.trim().toLowerCase();
  if (normalizedName.endsWith('.dng') || normalizedType === 'image/x-adobe-dng' || normalizedType === 'image/dng') {
    return 'image/tiff';
  }
  if (normalizedType === 'application/pdf' || normalizedType === 'image/jpeg' || normalizedType === 'image/png') {
    return normalizedType;
  }
  return null;
}
