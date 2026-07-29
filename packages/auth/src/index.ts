import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import pg from 'pg';

// Local schema definitions — avoids dependency on @axiom/db compiled output
const org = pgTable('org', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const appUser = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('operator'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

const db = drizzle({ client: new pg.Pool({ connectionString: process.env.DATABASE_URL }) });

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: appUser,
      organization: org,
    },
  }),
  emailAndPassword: {
    enabled: false,
  },
  magicLinks: {
    enabled: true,
  },
  organization: {
    enabled: true,
    async createOrganization(data: { name: string; slug?: string; logo?: string | null; [key: string]: any }) {
      const [newOrg] = await db
        .insert(org)
        .values({
          name: data.name,
          slug: data.slug ?? data.name.toLowerCase().replace(/\s+/g, '-'),
        })
        .returning();
      return newOrg;
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async () => {
          // Auto-create operator role assignment
        },
      },
    },
  },
  advanced: {
    cookiePrefix: 'axiom',
    defaultCookieAttributes: {
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    },
  },
});
