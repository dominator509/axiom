import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { signOut } from './auth';
import { clearStoredCookie, getStoredCookie, setStoredCookie } from './client';

// Protocol construction only. Native UI acceptance separately uses real Better
// Auth/PostgreSQL and verifies deletion of the server session after sign-out.
it('sends a JSON sign-out POST with its session cookie and clears local memory', async () => {
  let observed: { method?: string; url?: string; headers: IncomingHttpHeaders; body: string } | undefined;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      observed = { method: request.method, url: request.url, headers: request.headers, body };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"success":true}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  setStoredCookie('fixture_session=protocol-test');
  try {
    await signOut();
    expect(observed?.method).toBe('POST');
    expect(observed?.url).toBe('/api/auth/sign-out');
    expect(observed?.headers['content-type']).toBe('application/json');
    expect(observed?.headers.cookie).toBe('fixture_session=protocol-test');
    expect(observed?.body).toBe('{}');
    expect(getStoredCookie()).toBeNull();
  } finally {
    clearStoredCookie();
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = original;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
