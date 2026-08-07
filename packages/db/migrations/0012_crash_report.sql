-- 0012_crash_report.sql
-- F-73 (L2.9): Sentry/GlitchTip-style crash sink. Services report unhandled
-- exceptions as crash_report rows, grouped/deduped by fingerprint — a recurring
-- bug is ONE issue with a count, not noise. Org-scoped (RLS), cursor-sorted on
-- timestamp(3) last_seen per the keyset precision rule.
BEGIN;

CREATE TABLE IF NOT EXISTS crash_report (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID         NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    fingerprint    TEXT         NOT NULL,
    event_id       TEXT         NOT NULL,
    service        TEXT         NOT NULL,
    release        TEXT         NOT NULL DEFAULT 'unknown',
    environment    TEXT         NOT NULL DEFAULT 'production',
    message        TEXT         NOT NULL DEFAULT '',
    stacktrace     JSONB        NOT NULL DEFAULT '[]'::jsonb,
    correlation_id TEXT,
    severity       TEXT         NOT NULL DEFAULT 'sev-3'
                     CHECK (severity IN ('sev-1','sev-2','sev-3','sev-4')),
    status         TEXT         NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','resolved','ignored')),
    count          INTEGER      NOT NULL DEFAULT 1,
    first_seen     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_seen      TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (org_id, fingerprint)
);

-- Crash-loop detection is a hot query: same fingerprint recurrences in window.
CREATE INDEX IF NOT EXISTS idx_crash_report_fingerprint ON crash_report (org_id, fingerprint, last_seen DESC);

ALTER TABLE crash_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE crash_report FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON crash_report
    USING (org_id = current_setting('app.current_org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON crash_report TO axiom_app;
GRANT ALL ON crash_report TO axiom_migrator;

COMMIT;
