import { NextRequest, NextResponse } from 'next/server';
import { readBoundedResponseJson } from '@axiom/core';
import { resolveApiOrigin } from './lib/api-origin';

const API_ORIGIN = resolveApiOrigin();
export const SESSION_REQUEST_TIMEOUT_MS = 3_000;

export async function middleware(request: NextRequest) {
  // This namespace is served by the API's intentionally public Native page
  // router. Keep the private /models/:id/linkbio editor behind session auth.
  if (request.nextUrl.pathname === '/linkbio' || request.nextUrl.pathname.startsWith('/linkbio/')) {
    return NextResponse.next();
  }
  const isLogin = request.nextUrl.pathname === '/login';
  const cookie = request.headers.get('cookie') ?? '';
  let authenticated = false;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`session request timed out after ${SESSION_REQUEST_TIMEOUT_MS}ms`));
  }, SESSION_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ORIGIN}/api/auth/get-session`, {
      headers: cookie ? { cookie } : {},
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.ok) {
      const session = await readBoundedResponseJson<{ user?: unknown } | null>(response);
      authenticated = Boolean(session?.user);
    }
  } catch {
    authenticated = false;
  } finally {
    clearTimeout(timer);
  }

  if (!authenticated && !isLogin) return NextResponse.redirect(new URL('/login', request.url));
  if (authenticated && isLogin) return NextResponse.redirect(new URL('/', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
