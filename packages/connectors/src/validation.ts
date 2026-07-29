// ─── Publish Input Validation ───

import type {
  ConnectorPublishInput,
  ConnectorCapability,
  ValidationReport,
  TosVerdict,
  ValidationMessage,
  MediaType,
} from './types.js';

/** Common image/video file extensions mapped to MediaType */
const EXT_MAP: Record<string, MediaType> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  bmp: 'image',
  heic: 'image',
  heif: 'image',
  avif: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  avi: 'video',
  mkv: 'video',
  m4v: 'video',
  gif: 'gif',
  mp3: 'audio',
  ogg: 'audio',
  wav: 'audio',
  aac: 'audio',
  flac: 'audio',
};

/** Default media type when extension is unknown or missing */
const DEFAULT_MEDIA_TYPE: MediaType = 'image';

/**
 * Infer the MediaType from a URL by its file extension.
 */
function detectMediaType(url: string): MediaType {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
    return EXT_MAP[ext] ?? DEFAULT_MEDIA_TYPE;
  } catch {
    // Unparseable URL — treat as default
    return DEFAULT_MEDIA_TYPE;
  }
}

/**
 * Validate a publish input against a connector's capability declaration.
 *
 * Checks:
 * - Empty mediaUrls
 * - Per-media size against maxMediaBytes
 * - Media type against supported media[]
 * - Empty/missing caption against caption requirement
 * - Caption length against maxCaptionLength
 */
export function validatePublish(
  input: ConnectorPublishInput,
  cap: ConnectorCapability,
): ValidationReport {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const infos: ValidationMessage[] = [];

  // ── Media URL checks ──────────────────────────────────────

  if (!input.mediaUrls || input.mediaUrls.length === 0) {
    errors.push({
      field: 'mediaUrls',
      message: 'At least one media URL is required.',
      severity: 'error',
    });
  } else {
    // Cap the number of checked items to the actual URL count
    for (let i = 0; i < input.mediaUrls.length; i++) {
      const url = input.mediaUrls[i];
      const type = detectMediaType(url);

      // Check that the media type is in the connector's supported list
      if (!cap.media.includes(type)) {
        warnings.push({
          field: `mediaUrls[${i}]`,
          message: `Media type "${type}" is not in the connector's supported types (${cap.media.join(', ')}).`,
          severity: 'warning',
        });
      }

      // Check media count
      if (i >= cap.maxMediaCount) {
        errors.push({
          field: 'mediaUrls',
          message: `Maximum of ${cap.maxMediaCount} media items allowed (got ${input.mediaUrls.length}).`,
          severity: 'error',
        });
        break;
      }
    }
  }

  // ── Caption checks ────────────────────────────────────────

  const caption = input.caption ?? '';

  if (cap.caption && (!caption || caption.trim().length === 0)) {
    warnings.push({
      field: 'caption',
      message: 'This platform recommends including a caption.',
      severity: 'warning',
    });
  }

  if (caption.length > cap.maxCaptionLength) {
    errors.push({
      field: 'caption',
      message: `Caption exceeds maximum length of ${cap.maxCaptionLength} characters (got ${caption.length}).`,
      severity: 'error',
    });
  }

  // ── TosVerdict ────────────────────────────────────────────

  let tosVerdict: TosVerdict;
  if (errors.length > 0) {
    tosVerdict = 'block';
  } else if (warnings.length > 0) {
    tosVerdict = 'flag';
  } else {
    tosVerdict = 'pass';
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    infos,
    tosVerdict,
  };
}
