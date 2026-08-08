import { NextRequest, NextResponse } from 'next/server';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

export async function middleware(request: NextRequest) {
  const isLogin = request.nextUrl.pathname === '/login';
  const cookie = request.headers.get('cookie') ?? '';
  let authenticated = false;

  try {
    const response = await fetch(`${API_ORIGIN}/api/auth/get-session`, {
      headers: cookie ? { cookie } : {},
      cache: 'no-store',
    });
    if (response.ok) {
      const session = (await response.json()) as { user?: unknown } | null;
      authenticated = Boolean(session?.user);
    }
  } catch {
    authenticated = false;
  }

  if (!authenticated && !isLogin) return NextResponse.redirect(new URL('/login', request.url));
  if (authenticated && isLogin) return NextResponse.redirect(new URL('/', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
