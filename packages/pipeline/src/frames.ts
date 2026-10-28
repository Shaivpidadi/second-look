import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

/**
 * Frame analysis for keyframe sampling: decode PNG frames to grayscale,
 * score sharpness, and hash for change detection, all dependency-free.
 */

export interface DecodedGray {
  width: number;
  height: number;
  /** Row-major grayscale bytes, one per pixel. */
  gray: Uint8Array;
}

function u32be(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) |
      (bytes[at + 1]! << 16) |
      (bytes[at + 2]! << 8) |
      bytes[at + 3]!) >>>
    0
  );
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode an 8-bit non-interlaced PNG (grayscale, RGB, or RGBA) to
 * grayscale. ffmpeg-sampled clip frames and generator pages both qualify.
 */
export function decodePngToGray(png: Uint8Array): DecodedGray {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i++) {
    if (png[i] !== signature[i]) throw new Error("frames: not a PNG (bad signature)");
  }
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: number[] = [];
  let seenIhdr = false;
  while (at + 8 <= png.length) {
    const length = u32be(png, at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    const data = png.subarray(at + 8, at + 8 + length);
    if (at + 8 + length + 4 > png.length) throw new Error("frames: truncated PNG chunk");
    if (type === "IHDR") {
      width = u32be(data, 0);
      height = u32be(data, 4);
      const bitDepth = data[8]!;
      const colorType = data[9]!;
      if (bitDepth !== 8) throw new Error(`frames: only 8-bit PNG supported, got ${bitDepth}-bit`);
      if (colorType !== 0 && colorType !== 2 && colorType !== 6) {
        throw new Error(`frames: unsupported PNG color type ${colorType}`);
      }
      if (data[12] !== 0) throw new Error("frames: interlaced PNG not supported");
      channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
      seenIhdr = true;
    } else if (type === "IDAT") {
      for (const byte of data) idat.push(byte);
    } else if (type === "IEND") {
      break;
    }
    at += 8 + length + 4;
  }
  if (!seenIhdr || idat.length === 0) throw new Error("frames: PNG missing IHDR or IDAT");
  const raw = inflateSync(new Uint8Array(idat));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) {
    throw new Error("frames: PNG pixel data has unexpected length");
  }
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? new Uint8Array(stride) : pixels.subarray((y - 1) * stride, y * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let value = row[i]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`frames: unknown PNG filter ${filter}`);
      out[i] = value & 0xff;
    }
  }
  const gray = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (channels === 1) {
      gray[p] = pixels[p]!;
    } else {
      const r = pixels[p * channels]!;
      const g = pixels[p * channels + 1]!;
      const b = pixels[p * channels + 2]!;
      gray[p] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  return { width, height, gray };
}

/** Variance of the Laplacian: higher means sharper. 0 for tiny images. */
export function sharpness(image: DecodedGray): number {
  const { width, height, gray } = image;
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = gray[y * width + x]!;
      const laplacian =
        gray[(y - 1) * width + x]! +
        gray[(y + 1) * width + x]! +
        gray[y * width + x - 1]! +
        gray[y * width + x + 1]! -
        4 * center;
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function sample(image: DecodedGray, x: number, y: number): number {
  const sx = Math.min(image.width - 1, Math.floor((x * image.width) / 64));
  const sy = Math.min(image.height - 1, Math.floor((y * image.height) / 64));
  return image.gray[sy * image.width + sx]!;
}

/** 64-bit difference hash over an 8x8 grid for change detection. */
export function dhash64(image: DecodedGray): bigint {
  let hash = 0n;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      hash <<= 1n;
      if (sample(image, gx * 8, gy * 8 + 4) > sample(image, gx * 8 + 4, gy * 8 + 4)) {
        hash |= 1n;
      }
    }
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor !== 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

/** Stable sha256 over a 32x32 downscale: the extraction-cache key. */
export function frameHash(image: DecodedGray): string {
  const down = new Uint8Array(32 * 32);
  for (let gy = 0; gy < 32; gy++) {
    for (let gx = 0; gx < 32; gx++) {
      down[gy * 32 + gx] = sample(image, gx * 2, gy * 2);
    }
  }
  return createHash("sha256").update(down).digest("hex");
}

export interface FrameAnalysis {
  index: number;
  sharpness: number;
  dhash: bigint;
  hash: string;
}

export function analyzeFrames(pngs: Uint8Array[]): FrameAnalysis[] {
  return pngs.map((png, index) => {
    const image = decodePngToGray(png);
    return {
      index,
      sharpness: sharpness(image),
      dhash: dhash64(image),
      hash: frameHash(image),
    };
  });
}

export interface KeyframeOptions {
  /**
   * Max keyframes to keep; default 1. One sharpest keyframe keeps
   * end-to-end verdicts under the 5s target; pass more only for
   * robustness scans that can afford the sequential tail.
   */
  maxKeyframes?: number;
  /** Min dhash bits changed since the last keyframe; default 8. */
  changeThreshold?: number;
}

/**
 * Pick keyframes: always frame 0, then frames that changed enough since
 * the last pick. When the picks overflow `maxKeyframes`, frame 0 plus
 * the sharpest picks win.
 */
export function selectKeyframes(
  analyses: FrameAnalysis[],
  options: KeyframeOptions = {},
): number[] {
  const maxKeyframes = options.maxKeyframes ?? 1;
  const changeThreshold = options.changeThreshold ?? 8;
  if (!Number.isInteger(maxKeyframes) || maxKeyframes < 1) {
    throw new Error(`frames: maxKeyframes must be >= 1, got ${maxKeyframes}`);
  }
  if (analyses.length === 0) return [];
  const picked: FrameAnalysis[] = [analyses[0]!];
  for (const analysis of analyses.slice(1)) {
    if (hammingDistance(analysis.dhash, picked[picked.length - 1]!.dhash) >= changeThreshold) {
      picked.push(analysis);
    }
  }
  if (picked.length <= maxKeyframes) return picked.map((p) => p.index);
  const [first, ...rest] = picked;
  rest.sort((a, b) => b.sharpness - a.sharpness || a.index - b.index);
  const kept = [first!, ...rest.slice(0, maxKeyframes - 1)];
  kept.sort((a, b) => a.index - b.index);
  return kept.map((p) => p.index);
}
