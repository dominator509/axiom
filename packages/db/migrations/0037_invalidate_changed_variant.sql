-- Enforce attribution invalidation for every writer, including Relay and workers.
CREATE FUNCTION invalidate_changed_bundle_variant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.captions IS DISTINCT FROM OLD.captions
       OR NEW.hashtags IS DISTINCT FROM OLD.hashtags
       OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
       OR NEW.model_id IS DISTINCT FROM OLD.model_id
       OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
        NEW.source_variant_id := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER content_bundle_variant_invalidation
BEFORE UPDATE ON content_bundle
FOR EACH ROW EXECUTE FUNCTION invalidate_changed_bundle_variant();
