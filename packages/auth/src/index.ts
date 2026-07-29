import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@axiom/db';
import { org, appUser } from '@axiom/db/schema';
import { eq } from 'drizzle-orm';

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
    async createOrganization(data) {
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
        after: async (user) => {
          // Auto-create operator role assignment
          return user;
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
