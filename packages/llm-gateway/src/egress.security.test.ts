import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { createPublicEgressFetch } from './egress.js';

const servers: Server[] = [];
const agents: Array<{ close(): Promise<void> }> = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  })));
});

describe('controlled custom-domain egress security harness', () => {
  it('rejects a public-looking hostname mapped to loopback before a bearer request reaches the target', async () => {
    const authorizationHeaders: string[] = [];
    const target = createServer((request, response) => {
      authorizationHeaders.push(String(request.headers.authorization ?? ''));
      response.end('should not be reached');
    });
    const targetPort = await listen(target);
    const resolutions: string[] = [];
    const protectedFetch = createPublicEgressFetch(async (hostname) => {
      resolutions.push(hostname);
      return hostname === 'customer-fanlynks.example'
        ? [{ address: '127.0.0.1', family: 4 }]
        : [{ address: 'fe80::1', family: 6 }];
    });

    for (const hostname of ['customer-fanlynks.example', 'edge.customer-fanlynks.example']) {
      await expect(protectedFetch(`http://${hostname}:${targetPort}/analytics`, {
        headers: { authorization: 'Bearer codex-dns-rebinding-dummy' },
      })).rejects.toThrow();
    }

    expect(resolutions).toEqual(['customer-fanlynks.example', 'edge.customer-fanlynks.example']);
    expect(authorizationHeaders).toEqual([]);
  });

  it('does not follow a redirect from a public-looking origin to a private target', async () => {
    const privateRequests: string[] = [];
    const privateTarget = createServer((request, response) => {
      privateRequests.push(request.url ?? '');
      response.end('private target reached');
    });
    const privatePort = await listen(privateTarget);
    const initialRequests: Array<{ url: string; authorization: string }> = [];
    const controlledProxy = createServer((request, response) => {
      initialRequests.push({
        url: request.url ?? '',
        authorization: String(request.headers.authorization ?? ''),
      });
      response.writeHead(302, { location: `http://127.0.0.1:${privatePort}/metadata` });
      response.end();
    });
    const proxyPort = await listen(controlledProxy);
    const agent = new ProxyAgent(`http://127.0.0.1:${proxyPort}`);
    agents.push(agent);

    await expect(undiciFetch('http://customer-fanlynks.example/analytics', {
      dispatcher: agent,
      headers: { authorization: 'Bearer codex-dns-rebinding-dummy' },
      redirect: 'error',
    })).rejects.toThrow();

    assert.equal(initialRequests.length, 1);
    expect(initialRequests[0].url).toBe('http://customer-fanlynks.example/analytics');
    expect(initialRequests[0].authorization).toBe('Bearer codex-dns-rebinding-dummy');
    expect(privateRequests).toEqual([]);
  });
});
