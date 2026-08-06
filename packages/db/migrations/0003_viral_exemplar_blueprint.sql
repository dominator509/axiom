-- ============================================================================
-- AXIOM — Migration 0003 — Align viral_exemplar to L3.1 blueprint shape
-- ============================================================================
-- Migration 0000 created viral_exemplar with a divergent shape (title/url/
-- thumbnail_url/viral_label/metrics/ai_notes, embedding vector(1536)).
-- Blueprint L3.1 §6 (viral memory loop, L2.8) mandates:
--   model_id, bundle_id, features jsonb, embedding vector(768) NOT NULL,
--   perf_score double precision, label CHECK IN ('viral','strong','baseline','weak').
-- The dashboard (F-85) and viral route read label/perfScore/modelId; the old
-- shape never matched the spec. The table is empty at this point, so the
-- realignment is lossless. RLS policy on the table is unaffected (org_id).
-- ============================================================================

BEGIN;

-- Drop the HNSW index before altering the embedding column (pgvector forbids
-- ALTER TYPE on a column covered by an index).
DROP INDEX IF EXISTS idx_viral_exemplar_embedding;

-- Realign columns to the L3.1 blueprint shape. Table is empty (0 rows), so
-- dropping the divergent columns is safe and NOT NULL additions need no default.
ALTER TABLE viral_exemplar
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS url,
    DROP COLUMN IF EXISTS thumbnail_url,
    DROP COLUMN IF EXISTS viral_label,
    DROP COLUMN IF EXISTS metrics,
    DROP COLUMN IF EXISTS ai_notes,
    DROP COLUMN IF EXISTS embedding;

ALTER TABLE viral_exemplar
    ADD COLUMN model_id   uuid NOT NULL REFERENCES model_profile(id) ON DELETE CASCADE,
    ADD COLUMN bundle_id  uuid REFERENCES content_bundle(id) ON DELETE SET NULL,
    ADD COLUMN features   jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN perf_score double precision NOT NULL DEFAULT 0,
    ADD COLUMN label      text NOT NULL DEFAULT 'baseline'
        CHECK (label IN ('viral','strong','baseline','weak')),
    ADD COLUMN embedding  vector(768) NOT NULL;

-- Recreate the HNSW index (blueprint L3.1 §6) + hot-path indexes
CREATE INDEX IF NOT EXISTS idx_viral_exemplar_embedding
    ON viral_exemplar USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_viral_exemplar_model_id ON viral_exemplar(model_id);
CREATE INDEX IF NOT EXISTS idx_viral_exemplar_label ON viral_exemplar(label);
CREATE INDEX IF NOT EXISTS idx_viral_exemplar_org_id ON viral_exemplar(org_id);

COMMIT;
