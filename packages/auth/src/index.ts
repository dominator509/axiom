// ─── AXIOM Auth (Better Auth) — email/password + org-scoped sessions ───
// Mounted in the API at /api/auth/*. Users belong to an org (auth_user.org_id);
// the session middleware resolves the authenticated user's org and injects
// orgId/userId into the Hono context for RLS-scoped routes (LBI-02).

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Context, Next } from 'hono';
import { randomUUID } from 'node:crypto';

import type { UserRole } from '@axiom/core';
import { db } from '@axiom/db';
import { authUser, authSession, authAccount, authVerification } from '@axiom/db/schema';
import { resolveAuthConfig } from './config.js';

const runtimeConfig = resolveAuthConfig(process.env);
const environment = (process.env.AXIOM_ENV ?? process.env.NODE_ENV)?.trim();
const localDevelopment = environment === 'development' || environment === 'test';

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
  // The dashboard runs on its own local port during development. Production
  // stays pinned to the configured public origin (covered in config tests).
  trustedOrigins: runtimeConfig.trustedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  // Leave email verification unconfigured until a real delivery transport is
  // available. Better Auth then fails closed instead of reporting that a
  // verification email was sent when no message was delivered.
  advanced: {
    cookiePrefix: 'axiom',
    defaultCookieAttributes: {
      sameSite: 'lax',
      httpOnly: true,
      secure: !localDevelopment,
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
  role: UserRole | null;
} | null> {
  try {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session?.user?.id) return null;
    const orgId = (session.user as unknown as { orgId?: string | null }).orgId ?? null;
    const role = (session.user as unknown as { role?: unknown }).role;
    const validRole: UserRole | null =
      role === 'owner' ||
      role === 'manager' ||
      role === 'operator' ||
      role === 'analyst' ||
      role === 'agent'
        ? role
        : null;
    return { userId: session.user.id, orgId, role: validRole };
  } catch {
    return null;
  }
}

/**
 * Hono middleware: require an authenticated session, set userId + orgId in
 * the context. Routes that read c.get('orgId') get the session's org and
 * c.get('role') gets the server-assigned role. Requests without a valid
 * session → 401.
 */
export async function requireAuth(
  c: Context<{
    Variables: { userId: string; orgId: string; role: UserRole | null };
  }>,
  next: Next,
): Promise<Response | void> {
  const session = await getSessionFromRequest(c);
  if (!session) {
    // RFC-7807 problem+json (L3.0) with the request's correlation_id.
    const incoming = c.req.header('X-Correlation-ID');
    const correlationId =
      incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'unauthorized',
        correlation_id: correlationId,
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/problem+json; charset=UTF-8',
          'X-Correlation-ID': correlationId,
        },
      },
    );
  }
  c.set('userId', session.userId);
  c.set('orgId', session.orgId ?? '');
  c.set('role', session.role);
  return await next();
}

/**
 * Hono middleware for REST role checks.
 *
 * Roles are read from the Better Auth user record and are never accepted from
 * request input. A missing/invalid role fails closed with 403 so an auth
 * session cannot silently gain a privileged mutation path.
 */
export function requireRole(...allowed: UserRole[]) {
  return async function roleMiddleware(
    c: Context<{
      Variables: { userId: string; orgId: string; role: UserRole | null };
    }>,
    next: Next,
  ): Promise<Response | void> {
    const role = c.get('role');
    if (role && allowed.includes(role)) return await next();

    const incoming = c.req.header('X-Correlation-ID');
    const correlationId =
      incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'insufficient role for this operation',
        correlation_id: correlationId,
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/problem+json; charset=UTF-8',
          'X-Correlation-ID': correlationId,
        },
      },
    );
  };
}

/**
 * Apply a role check only to state-changing requests in a mixed read/write
 * route group. Read-only requests remain available to every authenticated
 * role; mutation routes must explicitly name the permitted human roles.
 */
export function requireMutationRole(...allowed: UserRole[]) {
  const check = requireRole(...allowed);
  return async function mutationRoleMiddleware(
    c: Context<{
      Variables: { userId: string; orgId: string; role: UserRole | null };
    }>,
    next: Next,
  ): Promise<Response | void> {
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
      return await next();
    }
    return await check(c, next);
  };
}

/** Hono middleware: best-effort auth — sets context when present, else 401. */
export async function optionalAuth(
  c: Context<{
    Variables: { userId: string; orgId: string; role: UserRole | null };
  }>,
  next: Next,
): Promise<Response | void> {
  return requireAuth(c, next);
}

export type { AuthContext } from './types.js';
