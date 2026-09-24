import { describe, expect, it } from 'vitest';
import {
  parseVaultFolder,
  parseVaultMedia,
  parseVaultPage,
  vaultFolderName,
  vaultMediaUuids,
  vaultPageValues,
} from './fanvue-vault.js';

const MEDIA_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('Fanvue vault contracts', () => {
  it('normalizes folder pages with bounded pagination', () => {
    expect(parseVaultPage({
      data: [{ name: 'My Photos', createdAt: null, mediaCount: 2 }],
      pagination: { page: 1, size: 15, hasMore: false },
    }, parseVaultFolder)).toEqual({
      items: [{ name: 'My Photos', createdAt: null, mediaCount: 2 }],
      pagination: { page: 1, size: 15, hasMore: false },
    });
  });

  it('accepts processing media with sparse provider fields and drops signed variant URLs', () => {
    expect(parseVaultMedia({ uuid: MEDIA_UUID, status: 'processing' })).toEqual({
      uuid: MEDIA_UUID,
      status: 'processing',
    });
    expect(parseVaultMedia({
      uuid: MEDIA_UUID,
      status: 'ready',
      createdAt: '2026-01-01T00:00:00Z',
      name: 'photo.jpg',
      mediaType: 'image',
      recommendedPrice: null,
      variants: [{ url: 'https://media.fanvue.test/signed?token=private' }],
    })).toEqual({
      uuid: MEDIA_UUID,
      status: 'ready',
      createdAt: '2026-01-01T00:00:00Z',
      name: 'photo.jpg',
      mediaType: 'image',
      recommendedPrice: null,
    });
  });

  it('rejects invalid folder, media, and pagination responses', () => {
    expect(() => parseVaultFolder({ name: '', createdAt: null, mediaCount: 0 })).toThrow('folder response');
    expect(() => parseVaultMedia({ uuid: 'not-a-uuid', status: 'ready' })).toThrow('media response');
    expect(() => parseVaultPage({ data: [], pagination: { page: 1, size: 1, hasMore: 'false' } }, parseVaultFolder)).toThrow('page response');
    expect(() => parseVaultPage({ data: [{ name: 'a', createdAt: null, mediaCount: 0 }, { name: 'b', createdAt: null, mediaCount: 0 }], pagination: { page: 1, size: 1, hasMore: false } }, parseVaultFolder)).toThrow('exceeded its declared size');
  });

  it('validates folder names, UUID batches, and bounded list pagination', () => {
    expect(vaultFolderName('  My Photos  ')).toBe('My Photos');
    expect(() => vaultFolderName(' ')).toThrow('1 to 255');
    expect(vaultMediaUuids([MEDIA_UUID, MEDIA_UUID])).toEqual([MEDIA_UUID]);
    expect(() => vaultMediaUuids(['not-a-uuid'])).toThrow('valid media UUIDs');
    expect(vaultPageValues(2, 50)).toEqual({ page: 2, size: 50 });
    expect(() => vaultPageValues(1, 51)).toThrow('pagination');
  });
});
