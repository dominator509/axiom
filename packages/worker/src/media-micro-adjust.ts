/** Pure, bounded RGBA transform. Not enabled in upload/generation until the
 * before/after preview and explicit approval path is connected.
 * No watermark detector or perceptual-anonymity claim is made here.
 */
export interface MicroAdjustment {
  /** Uniform adjustment to each visible RGB channel, in 8-bit levels. */
  rgbOffset: readonly [number, number, number];
  rotationDegrees: number;
  /** Fraction removed from EACH edge before resampling to original size. */
  cropPerEdge: number;
}

class AdjustmentConstraintError extends Error {}

/** At most nine local candidates; never provider retries. Every candidate is
 * derived from the ORIGINAL pixels, so adjustments cannot accumulate.
 * Eight-bit output cannot represent an arbitrarily small colour change.
 */
export function adaptiveMicroAdjustRgba(source: Uint8Array, width: number, height: number, options: MicroAdjustment) {
  for (let attempt = 0; attempt < 9; attempt++) {
    const scale = 2 ** -attempt;
    const candidate: MicroAdjustment = {
      rgbOffset: options.rgbOffset.map(value => Math.trunc(value * scale)) as [number, number, number],
      rotationDegrees: options.rotationDegrees * scale,
      cropPerEdge: options.cropPerEdge * scale,
    };
    try {
      // Attempt zero also validates the original request. Invalid dimensions,
      // unsupported option values and programming errors must not fall back.
      const result = microAdjustRgba(source, width, height, attempt === 0 ? options : candidate);
      return { ...result, adaptation: { attempts: attempt + 1, scale,
        outcome: result.receipt.maxChannelDelta > 0 ? 'adjusted' as const : 'unchanged' as const } };
    } catch (error) {
      if (!(error instanceof AdjustmentConstraintError)) throw error;
    }
  }
  const result = microAdjustRgba(source, width, height, { rgbOffset: [0, 0, 0], rotationDegrees: 0, cropPerEdge: 0 });
  return { ...result, adaptation: { attempts: 9, scale: 0, outcome: 'unchanged' as const } };
}

export function microAdjustRgba(source: Uint8Array, width: number, height: number, options: MicroAdjustment): {
  pixels: Uint8Array;
  receipt: { maxChannelDelta: number; normalizedMeanAbsoluteDifference: number;
    rgbOffset: readonly [number, number, number];
    rotationDegrees: number; cropPerEdge: number; requiresPreviewApproval: true };
} {
  const size = width * height * 4;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(size) || size > 160_000_000 || source.length !== size)
    throw new Error('Invalid micro-adjustment pixel buffer');
  if (!Array.isArray(options.rgbOffset) || options.rgbOffset.length !== 3
    // Array#some skips holes; inspect all three positions explicitly.
    || [0, 1, 2].some(index => !Number.isInteger(options.rgbOffset[index]) || Math.abs(options.rgbOffset[index]!) > 4)
    || !Number.isFinite(options.rotationDegrees) || Math.abs(options.rotationDegrees) > 0.05
    || !Number.isFinite(options.cropPerEdge) || options.cropPerEdge < 0 || options.cropPerEdge > 0.001)
    throw new Error('Micro-adjustment exceeds configured bounds');
  const geometric = options.rotationDegrees !== 0 || options.cropPerEdge !== 0;
  // Do not resample transparency with straight-alpha math or alter alpha.
  // This path rejects it instead of inventing opaque borders or hidden RGB.
  if (geometric) {
    for (let i = 3; i < source.length; i += 4) {
      if (source[i] !== 255) throw new AdjustmentConstraintError('Geometric adjustment requires opaque pixels');
    }
  }
  const pixels = new Uint8Array(source.length);
  const angle = options.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle), scale = 1 - 2 * options.cropPerEdge;
  const centerX = (width - 1) / 2, centerY = (height - 1) / 2;
  let maxChannelDelta = 0, totalDelta = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const sourceX = geometric ? centerX + scale * ((x - centerX) * cosine - (y - centerY) * sine) : x;
      const sourceY = geometric ? centerY + scale * ((x - centerX) * sine + (y - centerY) * cosine) : y;
      if (sourceX < -1e-9 || sourceY < -1e-9 || sourceX > width - 1 + 1e-9 || sourceY > height - 1 + 1e-9)
        throw new AdjustmentConstraintError('Rotation requires pixels outside the crop; no invented borders allowed');
      const sx = Math.max(0, Math.min(width - 1, sourceX)), sy = Math.max(0, Math.min(height - 1, sourceY));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
      const fx = sx - x0, fy = sy - y0;
      for (let channel = 0; channel < 3; channel++) {
        const top = source[(y0 * width + x0) * 4 + channel]! * (1 - fx) + source[(y0 * width + x1) * 4 + channel]! * fx;
        const bottom = source[(y1 * width + x0) * 4 + channel]! * (1 - fx) + source[(y1 * width + x1) * 4 + channel]! * fx;
        const value = source[index + 3] === 0 ? 0
          : Math.max(0, Math.min(255, Math.round(top * (1 - fy) + bottom * fy) + options.rgbOffset[channel]!));
        pixels[index + channel] = value;
        // Hidden RGB cleanup is separately authorized and not a visible edit.
        const delta = source[index + 3] === 0 ? 0 : Math.abs(value - source[index + channel]!);
        maxChannelDelta = Math.max(maxChannelDelta, delta); totalDelta += delta;
        if (delta > 4) throw new AdjustmentConstraintError('Combined transform exceeds the 4/255 source-relative channel limit');
      }
      pixels[index + 3] = source[index + 3]!;
    }
  }
  return { pixels, receipt: { maxChannelDelta, normalizedMeanAbsoluteDifference: totalDelta / (width * height * 3 * 255),
    rgbOffset: [options.rgbOffset[0]!, options.rgbOffset[1]!, options.rgbOffset[2]!],
    rotationDegrees: options.rotationDegrees, cropPerEdge: options.cropPerEdge, requiresPreviewApproval: true } };
}
