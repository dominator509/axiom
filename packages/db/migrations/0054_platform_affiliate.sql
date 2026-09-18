-- Platform-level SaaS acquisition referral program.
-- This is intentionally not tenant-scoped and is not a creator affiliate builder.
-- It records attributable FanThynks subscriptions, commission events, holds,
-- and payout exports. No provider payout or external publication is performed.

CREATE TABLE IF NOT EXISTS affiliate_program (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                       TEXT NOT NULL UNIQUE,
    name                       TEXT NOT NULL,
    status                     TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'paused', 'ended')),
    terms_version              TEXT NOT NULL,
    default_commission_bps     INTEGER NOT NULL DEFAULT 2000
      CHECK (default_commission_bps BETWEEN 0 AND 10000),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS affiliate_partner (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id                 UUID NOT NULL REFERENCES affiliate_program(id) ON DELETE RESTRICT,
    display_name               TEXT NOT NULL
      CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 160),
    email                      TEXT NOT NULL
      CHECK (char_length(btrim(email)) BETWEEN 3 AND 320),
    status                     TEXT NOT NULL DEFAULT 'invited'
      CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
    terms_version              TEXT,
    disclosure_accepted_at    TIMESTAMPTZ,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT affiliate_partner_program_email_unique UNIQUE (program_id, email)
);
CREATE INDEX IF NOT EXISTS affiliate_partner_program_status
  ON affiliate_partner(program_id, status);

CREATE TABLE IF NOT EXISTS affiliate_campaign (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id                 UUID NOT NULL REFERENCES affiliate_program(id) ON DELETE RESTRICT,
    partner_id                 UUID NOT NULL REFERENCES affiliate_partner(id) ON DELETE RESTRICT,
    name                       TEXT NOT NULL,
    slug                       TEXT NOT NULL
      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    referral_token             TEXT NOT NULL UNIQUE,
    status                     TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'active', 'paused', 'ended')),
    commission_bps             INTEGER NOT NULL
      CHECK (commission_bps BETWEEN 0 AND 10000),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT affiliate_campaign_program_slug_unique UNIQUE (program_id, slug)
);
CREATE INDEX IF NOT EXISTS affiliate_campaign_partner_status
  ON affiliate_campaign(partner_id, status);

CREATE TABLE IF NOT EXISTS affiliate_attribution_event (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id                 UUID NOT NULL REFERENCES affiliate_program(id) ON DELETE RESTRICT,
    campaign_id                UUID NOT NULL REFERENCES affiliate_campaign(id) ON DELETE RESTRICT,
    partner_id                 UUID NOT NULL REFERENCES affiliate_partner(id) ON DELETE RESTRICT,
    kind                       TEXT NOT NULL
      CHECK (kind IN ('click', 'visit', 'identity_stitch')),
    event_key                  TEXT NOT NULL UNIQUE,
    visitor_hash               TEXT,
    creator_user_id            TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
    metadata                   JSONB NOT NULL DEFAULT '{}'::jsonb
      CHECK (jsonb_typeof(metadata) = 'object'),
    occurred_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_attribution_campaign_kind
  ON affiliate_attribution_event(campaign_id, kind, occurred_at);

CREATE TABLE IF NOT EXISTS affiliate_conversion (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id                 UUID NOT NULL REFERENCES affiliate_program(id) ON DELETE RESTRICT,
    campaign_id                UUID NOT NULL REFERENCES affiliate_campaign(id) ON DELETE RESTRICT,
    partner_id                 UUID NOT NULL REFERENCES affiliate_partner(id) ON DELETE RESTRICT,
    creator_user_id            TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
    kind                       TEXT NOT NULL
      CHECK (kind IN ('subscription_started', 'subscription_renewed', 'subscription_refunded')),
    amount_cents               INTEGER NOT NULL CHECK (amount_cents >= 0),
    billing_event_key          TEXT NOT NULL UNIQUE,
    occurred_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_conversion_campaign_time
  ON affiliate_conversion(campaign_id, occurred_at);

CREATE TABLE IF NOT EXISTS affiliate_commission_event (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id                 UUID NOT NULL REFERENCES affiliate_program(id) ON DELETE RESTRICT,
    campaign_id                UUID NOT NULL REFERENCES affiliate_campaign(id) ON DELETE RESTRICT,
    partner_id                 UUID NOT NULL REFERENCES affiliate_partner(id) ON DELETE RESTRICT,
    conversion_id              UUID NOT NULL REFERENCES affiliate_conversion(id) ON DELETE RESTRICT,
    kind                       TEXT NOT NULL
      CHECK (kind IN ('accrued', 'approved', 'reversed', 'held', 'exported', 'paid')),
    amount_cents               INTEGER NOT NULL CHECK (amount_cents >= 0),
    event_key                  TEXT NOT NULL UNIQUE,
    reason                     TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_commission_partner_state
  ON affiliate_commission_event(partner_id, kind, created_at);

CREATE TABLE IF NOT EXISTS affiliate_hold (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id                 UUID NOT NULL REFERENCES affiliate_program(id) ON DELETE RESTRICT,
    partner_id                 UUID NOT NULL REFERENCES affiliate_partner(id) ON DELETE RESTRICT,
    commission_id              UUID REFERENCES affiliate_commission_event(id) ON DELETE RESTRICT,
    reason                     TEXT NOT NULL
      CHECK (reason IN ('fraud_suspected', 'chargeback', 'self_referral', 'terms_violation')),
    state                      TEXT NOT NULL DEFAULT 'open'
      CHECK (state IN ('open', 'resolved')),
    resolved_by_user_id        TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at                TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS affiliate_hold_partner_state
  ON affiliate_hold(partner_id, state);

CREATE TABLE IF NOT EXISTS affiliate_payout_export (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id                 UUID NOT NULL REFERENCES affiliate_program(id) ON DELETE RESTRICT,
    partner_id                 UUID NOT NULL REFERENCES affiliate_partner(id) ON DELETE RESTRICT,
    commission_ids             JSONB NOT NULL
      CHECK (jsonb_typeof(commission_ids) = 'array'),
    total_cents                INTEGER NOT NULL CHECK (total_cents >= 0),
    export_format              TEXT NOT NULL DEFAULT 'csv'
      CHECK (export_format = 'csv'),
    created_by_user_id         TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS affiliate_audit_event (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id                 UUID NOT NULL REFERENCES affiliate_program(id) ON DELETE RESTRICT,
    actor_user_id              TEXT REFERENCES auth_user(id) ON DELETE SET NULL,
    action                     TEXT NOT NULL,
    target                     TEXT NOT NULL,
    detail                     JSONB NOT NULL DEFAULT '{}'::jsonb
      CHECK (jsonb_typeof(detail) = 'object'),
    idempotency_key            TEXT NOT NULL UNIQUE,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_audit_program_time
  ON affiliate_audit_event(program_id, created_at);

INSERT INTO affiliate_program (slug, name, status, terms_version, default_commission_bps)
VALUES ('fanthynks', 'FanThynks creator referral program', 'active', 'v1', 2000)
ON CONFLICT (slug) DO NOTHING;

REVOKE ALL ON affiliate_program, affiliate_partner, affiliate_campaign,
  affiliate_attribution_event, affiliate_conversion, affiliate_commission_event,
  affiliate_hold, affiliate_payout_export, affiliate_audit_event FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON affiliate_program, affiliate_partner, affiliate_campaign TO axiom_app;
GRANT SELECT, INSERT ON affiliate_attribution_event, affiliate_conversion,
  affiliate_commission_event, affiliate_audit_event TO axiom_app;
GRANT SELECT, INSERT, UPDATE ON affiliate_hold TO axiom_app;
GRANT SELECT, INSERT ON affiliate_payout_export TO axiom_app;
GRANT ALL ON affiliate_program, affiliate_partner, affiliate_campaign,
  affiliate_attribution_event, affiliate_conversion, affiliate_commission_event,
  affiliate_hold, affiliate_payout_export, affiliate_audit_event TO axiom_migrator;
