import type {
  FanvueVaultFolder,
  FanvueVaultMedia,
  SocialOperationPagination,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Fanvue ${label} response is invalid`);
  }
  return value as Record<string, unknown>;
}

function optionalDate(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Fanvue ${label} response contains an invalid date`);
  }
  return value;
}

export function parseVaultFolder(value: unknown): FanvueVaultFolder {
  const item = record(value, 'vault folder');
  if (
    typeof item['name'] !== 'string' ||
    item['name'].trim().length < 1 ||
    item['name'].length > 255 ||
    !Number.isSafeInteger(item['mediaCount']) ||
    (item['mediaCount'] as number) < 0
  ) {
    throw new Error('Fanvue vault folder response is invalid');
  }
  const createdAt = optionalDate(item['createdAt'], 'vault folder');
  if (createdAt === undefined) throw new Error('Fanvue vault folder response omitted createdAt');
  return { name: item['name'], createdAt, mediaCount: item['mediaCount'] as number };
}

export function parseVaultMedia(value: unknown): FanvueVaultMedia {
  const item = record(value, 'vault media');
  if (
    typeof item['uuid'] !== 'string' || !UUID.test(item['uuid']) ||
    typeof item['status'] !== 'string' || item['status'].length < 1 || item['status'].length > 64
  ) {
    throw new Error('Fanvue vault media response is invalid');
  }
  const media: FanvueVaultMedia = { uuid: item['uuid'], status: item['status'] };
  const createdAt = optionalDate(item['createdAt'], 'vault media');
  if (createdAt !== undefined) media.createdAt = createdAt;
  for (const key of ['name', 'caption', 'description'] as const) {
    const field = item[key];
    if (field !== undefined && field !== null && (typeof field !== 'string' || field.length > 2_000)) {
      throw new Error(`Fanvue vault media ${key} is invalid`);
    }
    if (field !== undefined) media[key] = field as string | null;
  }
  const mediaType = item['mediaType'];
  if (mediaType !== undefined) {
    if (typeof mediaType !== 'string' || !MEDIA_TYPES.has(mediaType)) {
      throw new Error('Fanvue vault media type is invalid');
    }
    media.mediaType = mediaType as FanvueVaultMedia['mediaType'];
  }
  const recommendedPrice = item['recommendedPrice'];
  if (recommendedPrice !== undefined) {
    if (recommendedPrice !== null && (!Number.isSafeInteger(recommendedPrice) || (recommendedPrice as number) < 0)) {
      throw new Error('Fanvue vault media recommendedPrice is invalid');
    }
    media.recommendedPrice = recommendedPrice as number | null;
  }
  // Never return provider variant URLs: they can be temporary access URLs.
  return media;
}

export function parseVaultPage<T>(
  value: unknown,
  parseItem: (item: unknown) => T,
): { items: T[]; pagination: SocialOperationPagination } {
  const envelope = record(value, 'vault page');
  const pagination = record(envelope['pagination'], 'vault pagination');
  if (
    !Array.isArray(envelope['data']) ||
    !Number.isInteger(pagination['page']) || (pagination['page'] as number) < 1 ||
    !Number.isInteger(pagination['size']) || (pagination['size'] as number) < 1 ||
    typeof pagination['hasMore'] !== 'boolean'
  ) {
    throw new Error('Fanvue vault page response is invalid');
  }
  const items = envelope['data'].map(parseItem);
  if (items.length > (pagination['size'] as number)) {
    throw new Error('Fanvue vault page exceeded its declared size');
  }
  return {
    items,
    pagination: {
      page: pagination['page'] as number,
      size: pagination['size'] as number,
      hasMore: pagination['hasMore'],
    },
  };
}

export function vaultFolderName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 255) throw new Error('Fanvue vault folder name must contain 1 to 255 characters');
  return name;
}

export function vaultMediaUuids(values: string[]): string[] {
  if (values.length < 1 || values.length > 100 || values.some(value => !UUID.test(value))) {
    throw new Error('Fanvue vault media requires 1 to 100 valid media UUIDs');
  }
  return [...new Set(values)];
}

export function vaultPageValues(page = 1, size = 15): { page: number; size: number } {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 50) {
    throw new Error('Fanvue vault pagination requires page >= 1 and size between 1 and 50');
  }
  return { page, size };
}
