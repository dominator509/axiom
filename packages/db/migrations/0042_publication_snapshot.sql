-- Historical posts stay unattributed; do not reconstruct sent copy from an editable bundle.
ALTER TABLE post_target ADD COLUMN publication_snapshot JSONB;
CREATE FUNCTION preserve_publication_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.publication_snapshot IS NOT NULL AND NEW.publication_snapshot IS DISTINCT FROM OLD.publication_snapshot THEN
    RAISE EXCEPTION 'publication snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER post_target_snapshot_immutable BEFORE UPDATE ON post_target
FOR EACH ROW EXECUTE FUNCTION preserve_publication_snapshot();
