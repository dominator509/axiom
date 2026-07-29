import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';
import pg from 'pg';

export const db = drizzle({ client: new pg.Pool({ connectionString: process.env.DATABASE_URL }), schema });
export { schema };
