import type { FanvueConnector } from '@axiom/connectors';

type Media = Awaited<ReturnType<FanvueConnector['fetchMessageMedia']>>;

/** Explicit projection: never forward signed URLs, provider names or errors. */
export function inboxMediaMetadata(media: Media, messageUuid: string, ids: string[]) {
  return {
    kind: 'attachments' as const, messageUuid,
    data: ids.map(id => {
      const item = media.results[id];
      if (!item) return { uuid: id, available: false as const };
      return {
        uuid: item.uuid, available: true as const, mediaType: item.mediaType,
        purchasedAt: item.purchasedAt ?? null, pricing: item.pricing ?? null, amountPaid: item.amountPaid ?? null,
        variants: (item.variants ?? []).map(variant => ({
          variantType: variant.variantType, width: variant.width, height: variant.height, lengthMs: variant.lengthMs,
        })),
      };
    }),
  };
}
