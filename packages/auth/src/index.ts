// ─── AXIOM Auth (Better Auth) — email/password + org-scoped sessions ───
// Mounted in the API at /api/auth/*. Users belong to an org (auth_user.org_id);
// the session middleware resolves the authenticated user's org and injects
// orgId/userId into the Hono context for RLS-scoped routes (LBI-02).

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Context, Next } from 'hono';

import { db } from '@axiom/db';
import { authUser, authSession, authAccount, authVerification } from '@axiom/db/schema';
import { resolveAuthConfig } from './config.js';

const runtimeConfig = resolveAuthConfig(process.env);

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
  secret: runtimeConfig.secret,
  baseURL: runtimeConfig.baseURL,
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
    const orgId = (session.user as unknown as { orgId?: string | null }).orgId ?? null;
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
    // RFC-7807 problem+json (L3.0) with the request's correlation_id.
    const correlationId = c.req.header('X-Correlation-ID') ?? '';
    return c.json(
      {
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'unauthorized',
        correlation_id: correlationId,
      },
      401,
    );
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
