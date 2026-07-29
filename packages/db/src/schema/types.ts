import { customType } from 'drizzle-orm/pg-core';
export const bytea = customType<{ data: Buffer; driverData: string }>({ dataType: () => 'bytea' });
