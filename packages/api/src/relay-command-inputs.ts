import { asPlatform } from '@axiom/worker';
import type { CardAction } from '@axiom/relay';

export const RELAY_CAPTION_MAX_LENGTH = 10_000;

export function relayScheduledFor(
  params: Record<string, unknown>,
  action: CardAction,
  now = Date.now(),
): Date {
  const raw = params.scheduledFor ?? params.slot;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`relay command: ${action} requires a scheduledFor timestamp`);
  }
  const scheduledFor = new Date(raw);
  if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= now) {
    throw new Error(`relay command: ${action} requires a valid future timestamp`);
  }
  return scheduledFor;
}

export function relayCaptionUpdate(
  params: Record<string, unknown>,
  captions: Record<string, string>,
): { platform: string; caption: string } {
  const rawCaption = params.caption ?? params.text;
  if (typeof rawCaption !== 'string' || rawCaption.trim().length === 0) {
    throw new Error('relay command: edit_caption requires a non-empty caption');
  }
  if (rawCaption.length > RELAY_CAPTION_MAX_LENGTH) {
    throw new Error(
      `relay command: edit_caption caption exceeds ${RELAY_CAPTION_MAX_LENGTH} characters`,
    );
  }

  const rawPlatform = params.platform;
  const existingPlatforms = Object.keys(captions);
  const platform =
    typeof rawPlatform === 'string' && rawPlatform.trim().length > 0
      ? rawPlatform.trim()
      : existingPlatforms.length === 1
        ? existingPlatforms[0]
        : undefined;
  if (!platform) {
    throw new Error('relay command: edit_caption requires a platform when captions are ambiguous');
  }
  try {
    return { platform: asPlatform(platform), caption: rawCaption };
  } catch {
    throw new Error(`relay command: unsupported caption platform '${platform}'`);
  }
}
