import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { loadDashboard } from './dashboard';

// Real HTTP client/parser contract tests. Role enforcement itself is exercised
// separately against the isolated API and PostgreSQL native acceptance fixture.
it('keeps permitted panels available for non-owners and preserves partial failures', async () => {
  let deniedSettings = false;
  let failedCrashes = false;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url!;
    requests.push(path);
    response.setHeader('Content-Type', 'application/json');
    if ((path.endsWith('org-settings') && deniedSettings) || (path.endsWith('crash-reports') && failedCrashes)) {
      response.statusCode = path.endsWith('org-settings') ? 403 : 503;
      response.end(JSON.stringify({ detail: 'panel unavailable' }));
      return;
    }
    const data = path.endsWith('org-settings')
      ? { orgId: 'fixture', publishingEnabled: false, viralSharing: false }
      : path.endsWith('ui-locale')
        ? { locale: 'ja', source: 'user', userLocale: 'ja', orgLocale: null, canSetOrg: false, supportedLocales: ['en', 'es', 'ja', 'it', 'pt-BR', 'de'] }
        : [];
    response.end(JSON.stringify({ success: true, data, meta: { total: 0, limit: 20, next_cursor: null } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const role of ['operator', 'manager', 'viewer', null]) {
      requests.length = 0;
      const result = await loadDashboard(role);
      expect(requests).not.toContain('/api/v1/org-settings');
      expect(result.settings).toBeNull();
      expect(result.uiLocale?.locale).toBe('ja');
      expect(result.digests).toEqual([]);
      expect(result.crashReports).toEqual([]);
      expect(result.error).toBeNull();
    }
    const owner = await loadDashboard('owner');
    expect(owner.settings?.publishingEnabled).toBe(false);
    deniedSettings = true;
    failedCrashes = true;
    const partial = await loadDashboard('owner');
    expect(partial.settings).toBeNull();
    expect(partial.crashReports).toBeNull();
    expect(partial.digests).toEqual([]);
    expect(partial.uiLocale?.locale).toBe('ja');
    expect(partial.error).toBeTruthy();
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = original;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
