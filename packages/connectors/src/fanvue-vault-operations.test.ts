import { describe, expect, it, vi } from 'vitest';
import { FanvueConnector } from './fanvue.js';
import type { ConnectorAuth } from './types.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const folder = { name: 'My Photos', createdAt: null, mediaCount: 1 };
const page = { page: 1, size: 15, hasMore: false };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function auth(scopes: string[] = ['read:media', 'write:media']): ConnectorAuth {
  return { accessToken: 'fixture-token', externalUserId: 'creator-1', extra: { grantedScopes: scopes } };
}

describe('Fanvue vault operations', () => {
  it('advertises read and write actions only for the scopes actually granted', () => {
    expect(new FanvueConnector(auth(['read:media'])).capability().operations).toEqual([
      'vault.folders.read', 'vault.folder.read', 'vault.media.read',
    ]);
    expect(new FanvueConnector(auth(['write:media'])).capability().operations).toEqual([
      'vault.folder.create', 'vault.folder.rename', 'vault.folder.delete',
      'vault.media.add', 'vault.media.remove', 'vault.media.update',
    ]);
  });

  it('lists folders with bounded filters and the documented version/auth headers', async () => {
    const fetcher = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return json({ data: [folder], pagination: page });
    });
    const connector = new FanvueConnector(auth(['read:media']), fetcher as typeof fetch);
    const result = await connector.listVaultFolders(1, 15, 'Photos');
    expect(result.items).toEqual([folder]);
    const [url, init] = fetcher.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/vault/folders');
    expect(parsed.searchParams.get('mediaName')).toBe('Photos');
    expect(parsed.searchParams.get('size')).toBe('15');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer fixture-token');
    expect((init?.headers as Record<string, string>)['X-Fanvue-API-Version']).toBe('2025-06-26');
  });

  it('creates/renames/deletes folders and keeps names encoded in provider paths', async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      const parsed = new URL(String(url));
      return json({ name: init?.method === 'POST' ? 'New Folder' : decodeURIComponent(parsed.pathname.split('/').at(-1) ?? ''), createdAt: null, mediaCount: 0 });
    });
    const connector = new FanvueConnector(auth(['write:media']), fetcher as typeof fetch);
    await expect(connector.createVaultFolder('New Folder')).resolves.toMatchObject({ name: 'New Folder' });
    await expect(connector.renameVaultFolder('Old / Folder', 'Renamed')).resolves.toMatchObject({ name: 'Old / Folder' });
    await expect(connector.deleteVaultFolder('Old / Folder')).resolves.toBeUndefined();
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('Old%20%2F%20Folder');
    expect(JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string)).toEqual({ name: 'Renamed' });
  });

  it('lists media without exposing signed variant URLs and supports validated organization actions', async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/media?')) return json({
        data: [{ uuid: UUID, status: 'ready', name: 'photo.jpg', mediaType: 'image', variants: [{ url: 'https://media.fanvue.test/private?token=secret' }] }],
        pagination: page,
      });
      if (init?.method === 'POST') return json({ addedCount: 1 }, 201);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json({ uuid: UUID, status: 'ready' });
    });
    const connector = new FanvueConnector(auth(), fetcher as typeof fetch);
    const listed = await connector.listVaultMedia('My Photos', { mediaType: 'image', variants: ['main'] });
    expect(listed.items[0]).toMatchObject({ uuid: UUID, name: 'photo.jpg', mediaType: 'image' });
    expect(JSON.stringify(listed)).not.toContain('media.fanvue.test');
    expect(await connector.addVaultMedia('My Photos', [UUID])).toBe(1);
    await connector.updateVaultMedia('My Photos', UUID, { name: 'renamed.jpg', recommendedPrice: 500 });
    await connector.removeVaultMedia('My Photos', UUID);
    expect(JSON.parse(fetcher.mock.calls[2]?.[1]?.body as string)).toEqual({ name: 'renamed.jpg', recommendedPrice: 500 });
    expect(String(fetcher.mock.calls[3]?.[0])).toContain(`/media/${UUID}`);
  });

  it('enforces scope and input validation before any provider request', async () => {
    const fetcher = vi.fn();
    const reader = new FanvueConnector(auth(['read:media']), fetcher as typeof fetch);
    await expect(reader.createVaultFolder('No write grant')).rejects.toThrow('required permission was not granted');
    await expect(reader.addVaultMedia('folder', ['invalid'])).rejects.toThrow('required permission was not granted');
    const writer = new FanvueConnector(auth(['write:media']), fetcher as typeof fetch);
    await expect(writer.addVaultMedia('folder', ['invalid'])).rejects.toThrow('valid media UUIDs');
    await expect(writer.listVaultFolders()).rejects.toThrow('required permission was not granted');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('dispatches vault operations through the shared provider operation contract', async () => {
    const fetcher = vi.fn(async () => json({ data: [folder], pagination: page }));
    const connector = new FanvueConnector(auth(['read:media']), fetcher as typeof fetch);
    await expect(connector.executeOperation({ type: 'vault.folders.read' })).resolves.toEqual({
      type: 'vault.folders', items: [folder], pagination: page,
    });
  });
});
