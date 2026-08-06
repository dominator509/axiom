// ─── AXIOM Auth (Better Auth) — email/password + org-scoped sessions ───
// Mounted in the API at /api/auth/*. Users belong to an org (auth_user.org_id);
// the session middleware resolves the authenticated user's org and injects
// orgId/userId into the Hono context for RLS-scoped routes (LBI-02).

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Context, Next } from 'hono';

import {
  authUser,
  authSession,
  authAccount,
  authVerification,
} from '@axiom/db/schema';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://axiom:axiom@localhost:5432/axiom_dev';

const db = drizzle({
  client: new pg.Pool({ connectionString: DATABASE_URL }),
  schema: {
    user: authUser,
    session: authSession,
    account: authAccount,
    verification: authVerification,
  },
});

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
    },
  }),
  secret: process.env.BETTER_AUTH_SECRET ?? 'axiom-dev-secret-change-me',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3001',
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  emailVerification: {
    sendVerificationEmail: async () => {
      // Email transport is out of scope for the self-hosted dashboard; sign-up
      // auto-verifies when EMAIL_AUTO_VERIFY is set (dev/self-host default).
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
  user: {
    additionalFields: {
      orgId: {
        type: 'string',
        required: false,
        input: false, // never set from the client — assigned by the server
      },
      role: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
});

/**
 * Resolve the authenticated session from a Hono request.
 * Returns { userId, orgId } or null when unauthenticated.
 */
export async function getSessionFromRequest(c: Context): Promise<{
  userId: string;
  orgId: string | null;
} | null> {
  try {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session?.user?.id) return null;
    const orgId =
      (session.user as unknown as { orgId?: string | null }).orgId ?? null;
    return { userId: session.user.id, orgId };
  } catch {
    return null;
  }
}

/**
 * Hono middleware: require an authenticated session, set userId + orgId in
 * the context. Routes that read c.get('orgId') get the session's org.
 * Requests without a valid session → 401.
 */
export async function requireAuth(
  c: Context<{
    Variables: { userId: string; orgId: string };
  }>,
  next: Next,
): Promise<Response | void> {
  const session = await getSessionFromRequest(c);
  if (!session) {
    return c.json({ error: { message: 'unauthorized' } }, 401);
  }
  c.set('userId', session.userId);
  c.set('orgId', session.orgId ?? '');
  return await next();
}

/** Hono middleware: best-effort auth — sets context when present, else 401. */
export async function optionalAuth(
  c: Context<{
    Variables: { userId: string; orgId: string };
  }>,
  next: Next,
): Promise<Response | void> {
  return requireAuth(c, next);
}

export type { AuthContext } from './types.js';
