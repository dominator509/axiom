import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema/index.js';

// Derive the deployed application's requirements from its compiled schema, not
// a manually maintained table count. No tenant rows or credentials are read.
export const databaseReadinessColumns = Object.values(schema)
  .flatMap((table) => {
    if (!is(table, PgTable)) return [];
    const config = getTableConfig(table);
    return config.columns.map((column) => ({
      table_name: config.name, column_name: column.name,
    }));
  });

export const databaseReadinessSql = `
  SELECT count(*) > 0 AND coalesce(bool_and(
    c.oid IS NOT NULL AND c.relkind IN ('r', 'p')
    AND a.attnum IS NOT NULL
    AND has_schema_privilege(current_user, n.oid, 'USAGE')
    AND has_column_privilege(current_user, c.oid, a.attnum, 'SELECT')
  ), false) AS ready
  FROM jsonb_to_recordset($1::jsonb) AS required(table_name text, column_name text)
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = required.table_name
  LEFT JOIN pg_attribute a ON a.attrelid = c.oid
    AND a.attname = required.column_name AND a.attnum > 0 AND NOT a.attisdropped
`;

export interface ReadinessQuery {
  query(text: string, values: string[]): Promise<{ rows: { ready: boolean }[] }>;
}

/** Connectivity plus required tables/columns and runtime read privileges.
 * Not a backup-integrity, full migration-checksum, RLS, or provider acceptance gate.
 */
export async function assertDatabaseReady(database: ReadinessQuery): Promise<void> {
  const result = await database.query(databaseReadinessSql, [JSON.stringify(databaseReadinessColumns)]);
  if (result.rows.length !== 1 || result.rows[0]?.ready !== true) {
    throw new Error('Database schema is not ready');
  }
}
