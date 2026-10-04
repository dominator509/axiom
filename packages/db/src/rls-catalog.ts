import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema/index.js';

// Existing, reviewed exceptions: authentication precedes tenant resolution;
// capability revocation is global; affiliate acquisition belongs to the platform.
// Do not add tenant tables here to make a failing catalog check pass.
export const nonTenantTables = new Set([
  'auth_user', 'auth_session', 'auth_account', 'auth_verification',
  'mcp_token_revocation',
  'affiliate_program', 'affiliate_partner', 'affiliate_campaign',
  'affiliate_attribution_event', 'affiliate_conversion', 'affiliate_commission_event',
  'affiliate_hold', 'affiliate_payout_export', 'affiliate_audit_event',
]);

export const tenantTableNames = Object.values(schema)
  .filter(table => is(table, PgTable))
  .map(table => getTableConfig(table as PgTable).name)
  .filter(name => !nonTenantTables.has(name))
  .sort();

// This checks the effective catalog as the CURRENT role, not SQL source counts.
// Additional permissive policies combine with OR and can bypass org_isolation.
// Additional restrictive policies are allowed; their semantics still need tests.
export const rlsCatalogSql = `
WITH expected AS (
  SELECT jsonb_array_elements_text($1::jsonb) AS table_name
), role_state AS (
  SELECT NOT rolsuper AND NOT rolbypassrls AND NOT EXISTS (
    SELECT 1 FROM pg_roles elevated WHERE (elevated.rolsuper OR elevated.rolbypassrls)
      AND pg_has_role(current_user, elevated.oid, 'MEMBER')
  ) AS safe
  FROM pg_roles WHERE rolname = current_user
), catalog AS (
  SELECT e.table_name, c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity,
    c.relkind, p.polcmd, p.polpermissive, p.polqual, p.polroles
  FROM expected e
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
  LEFT JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'org_isolation'
)
SELECT table_name,
  coalesce((SELECT safe FROM role_state), false) AS runtime_role_safe,
  coalesce(oid IS NOT NULL AND relkind IN ('r','p') AND relrowsecurity
    AND relforcerowsecurity AND polcmd = '*' AND polpermissive AND polqual IS NOT NULL
    AND (0 = ANY(polroles) OR EXISTS (
      SELECT 1 FROM unnest(polroles) role_id
      WHERE role_id <> 0 AND pg_has_role(current_user, role_id, 'USAGE')
    ))
    AND NOT pg_has_role(current_user, relowner, 'MEMBER')
    AND NOT EXISTS (
      SELECT 1 FROM pg_policy extra
      WHERE extra.polrelid = catalog.oid AND extra.polname <> 'org_isolation'
        AND extra.polpermissive
        AND (0 = ANY(extra.polroles) OR EXISTS (
          SELECT 1 FROM unnest(extra.polroles) role_id
          WHERE role_id <> 0 AND pg_has_role(current_user, role_id, 'USAGE')
        ))
    ), false) AS protected
FROM catalog ORDER BY table_name
`;

export interface RlsCatalogRow {
  table_name: string;
  runtime_role_safe: boolean;
  protected: boolean;
}

export function assertRlsCatalog(rows: RlsCatalogRow[]): void {
  if (!tenantTableNames.length || new Set(tenantTableNames).size !== tenantTableNames.length
    || rows.length !== tenantTableNames.length
    || rows.some((row, index) => row.table_name !== tenantTableNames[index]
      || row.runtime_role_safe !== true || row.protected !== true)) {
    throw new Error('Effective tenant RLS catalog or runtime role is unsafe');
  }
}
