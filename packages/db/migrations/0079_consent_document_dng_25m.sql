-- Expand encrypted consent documents to 25 MiB and permit DNG stored as TIFF.
-- The API verifies the required DNGVersion tag before writing image/tiff rows.
ALTER TABLE consent_record
  DROP CONSTRAINT consent_document_metadata_check,
  ADD CONSTRAINT consent_document_metadata_check CHECK (
    (document_ciphertext IS NULL AND document_mime_type IS NULL AND document_size IS NULL)
    OR
    (document_ciphertext IS NOT NULL
      AND document_mime_type IS NOT NULL
      AND document_mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/tiff')
      AND document_size IS NOT NULL
      AND document_size BETWEEN 1 AND 26214400)
  );
