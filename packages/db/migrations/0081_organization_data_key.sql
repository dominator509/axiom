-- Per-organization data-encryption keys, wrapped by the configured root KEK.
-- Only wrapped key bytes are persisted; plaintext DEKs exist in the egress
-- plane for the duration of an encrypt/decrypt operation.
BEGIN;

CREATE TABLE organization_data_key (
    org_id       UUID        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    dek_id       UUID        NOT NULL,
    wrapped_dek  BYTEA       NOT NULL,
    wrap_nonce   BYTEA       NOT NULL CHECK (octet_length(wrap_nonce) = 24),
    kek_id       TEXT        NOT NULL CHECK (length(kek_id) BETWEEN 1 AND 128),
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, dek_id),
    CHECK (octet_length(wrapped_dek) = 48)
);

CREATE UNIQUE INDEX organization_data_key_one_active_per_org
    ON organization_data_key(org_id)
    WHERE is_active;

ALTER TABLE organization_data_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_data_key FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON organization_data_key
    USING (org_id = current_setting('app.current_org_id')::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON organization_data_key TO axiom_app;
GRANT ALL PRIVILEGES ON organization_data_key TO axiom_migrator;

-- The egress reconciler has to unwrap keys for rows across tenants. Keep the
-- runtime role under FORCE RLS and expose only wrapped DEK bytes through this
-- ACL-locked resolver, following load_model_network_configs().
CREATE FUNCTION load_organization_data_keys()
RETURNS SETOF public.organization_data_key
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM public.organization_data_key ORDER BY org_id, dek_id
$$;

REVOKE ALL ON FUNCTION load_organization_data_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION load_organization_data_keys() TO axiom_app;
GRANT EXECUTE ON FUNCTION load_organization_data_keys() TO axiom_migrator;

COMMIT;
