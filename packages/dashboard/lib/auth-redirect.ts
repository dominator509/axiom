/** Use an operator-configured origin, never caller-supplied forwarding headers. */
export function authRedirectUrl(path: '/login' | '/', requestUrl: string, configured?: string): URL {
  if (!configured) return new URL(path, requestUrl);
  const origin = new URL(configured);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))
    || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('BETTER_AUTH_URL must be an exact HTTPS or loopback HTTP origin');
  }
  return new URL(path, origin.origin);
}
