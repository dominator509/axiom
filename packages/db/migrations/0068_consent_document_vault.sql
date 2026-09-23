-- F87: persist only authenticated-encrypted consent bytes, never plaintext.
ALTER TABLE consent_record
  ADD COLUMN document_ciphertext bytea,
  ADD COLUMN document_mime_type text,
  ADD COLUMN document_size integer;

ALTER TABLE consent_record
  ADD CONSTRAINT consent_document_metadata_check CHECK (
    (document_ciphertext IS NULL AND document_mime_type IS NULL AND document_size IS NULL)
    OR
    (document_ciphertext IS NOT NULL
      AND document_mime_type IS NOT NULL
      AND document_mime_type IN ('application/pdf', 'image/jpeg', 'image/png')
      AND document_size IS NOT NULL
      AND document_size BETWEEN 1 AND 10485760)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON consent_record TO axiom_app;
GRANT ALL ON consent_record TO axiom_migrator;
