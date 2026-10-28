import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeJpegToGray,
  dhash64,
  encodeGrayToJpeg,
  encodeRgbToJpeg,
  frameHash,
  hammingDistance,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** 48x32 RGB: horizontal gradient, vertical checker band, hard edges. */
function testRgb(width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const checker = ((x >> 3) + (y >> 3)) % 2 === 0 ? 200 : 40;
      rgb[p * 3] = Math.round((x / Math.max(1, width - 1)) * 255);
      rgb[p * 3 + 1] = checker;
      rgb[p * 3 + 2] = Math.round((y / Math.max(1, height - 1)) * 255);
    }
  }
  return rgb;
}

function lumaOf(rgb: Uint8Array, p: number): number {
  return Math.round(0.299 * rgb[p * 3]! + 0.587 * rgb[p * 3 + 1]! + 0.114 * rgb[p * 3 + 2]!);
}

function meanAbsError(decoded: Uint8Array, expected: (p: number) => number): number {
  let sum = 0;
  for (let p = 0; p < decoded.length; p++) sum += Math.abs(decoded[p]! - expected(p));
  return sum / decoded.length;
}

test("jpeg: RGB round trip stays close to the source luma", () => {
  const width = 48;
  const height = 32;
  const rgb = testRgb(width, height);
  const decoded = decodeJpegToGray(encodeRgbToJpeg(rgb, width, height));
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  const mean = meanAbsError(decoded.gray, (p) => lumaOf(rgb, p));
  assert.ok(mean < 6, `mean abs error ${mean} exceeds 6`);
});

test("jpeg: gray round trip handles odd dimensions", () => {
  const width = 33;
  const height = 17;
  const gray = new Uint8Array(width * height);
  for (let p = 0; p < gray.length; p++) gray[p] = (p * 7 + (p >> 5) * 13) % 256;
  const decoded = decodeJpegToGray(encodeGrayToJpeg(gray, width, height));
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  const mean = meanAbsError(decoded.gray, (p) => gray[p]!);
  assert.ok(mean < 8, `mean abs error ${mean} exceeds 8`);
});

test("jpeg: 1x1 gray round trip", () => {
  const decoded = decodeJpegToGray(encodeGrayToJpeg(Uint8Array.from([200]), 1, 1));
  assert.equal(decoded.width, 1);
  assert.equal(decoded.height, 1);
  assert.ok(Math.abs(decoded.gray[0]! - 200) < 5);
});

test("jpeg: identical frames hash equal, different frames hash far apart", () => {
  const rgb = testRgb(48, 32);
  const first = decodeJpegToGray(encodeRgbToJpeg(rgb, 48, 32));
  const second = decodeJpegToGray(encodeRgbToJpeg(rgb, 48, 32));
  assert.equal(hammingDistance(dhash64(first), dhash64(second)), 0);
  assert.equal(frameHash(first), frameHash(second));
  const inverted = Uint8Array.from(rgb.map((v) => 255 - v));
  const other = decodeJpegToGray(encodeRgbToJpeg(inverted, 48, 32));
  assert.ok(hammingDistance(dhash64(first), dhash64(other)) > 8);
  assert.notEqual(frameHash(first), frameHash(other));
});

test("jpeg: near-duplicate frames hash close together", () => {
  const rgb = testRgb(64, 48);
  const base = decodeJpegToGray(encodeRgbToJpeg(rgb, 64, 48));
  const noisy = Uint8Array.from(rgb);
  for (let p = 0; p < noisy.length; p += 97) noisy[p] = (noisy[p]! + 3) % 256;
  const near = decodeJpegToGray(encodeRgbToJpeg(noisy, 64, 48));
  assert.ok(hammingDistance(dhash64(base), dhash64(near)) < 8);
});

test("jpeg: rejects non-JPEG input", () => {
  assert.throws(() => decodeJpegToGray(new Uint8Array([1, 2, 3, 4])), /not a JPEG/);
  assert.throws(() => decodeJpegToGray(new Uint8Array(0)), /not a JPEG/);
});

test("jpeg: rejects truncated files", () => {
  const full = encodeGrayToJpeg(new Uint8Array(16 * 16).fill(128), 16, 16);
  assert.throws(() => decodeJpegToGray(full.subarray(0, 40)), /truncated/);
  assert.throws(() => decodeJpegToGray(full.subarray(0, full.length - 10)), /truncated|scan/);
});

test("jpeg: rejects progressive scans", () => {
  const jpeg = Array.from(encodeGrayToJpeg(new Uint8Array(16 * 16).fill(128), 16, 16));
  const sof = jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xc0);
  assert.ok(sof > 0);
  jpeg[sof + 1] = 0xc2;
  assert.throws(() => decodeJpegToGray(Uint8Array.from(jpeg)), /progressive/);
});

test("jpeg: rejects 12-bit samples", () => {
  const jpeg = Array.from(encodeGrayToJpeg(new Uint8Array(16 * 16).fill(128), 16, 16));
  const sof = jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xc0);
  assert.ok(sof > 0);
  jpeg[sof + 4] = 12;
  assert.throws(() => decodeJpegToGray(Uint8Array.from(jpeg)), /8-bit/);
});

test("jpeg: decodes a real third-party encoder file (sips fixture)", () => {
  const bytes = new Uint8Array(
    readFileSync(join(here, "fixtures", "sips-48x32.jpg")),
  );
  const decoded = decodeJpegToGray(bytes);
  assert.equal(decoded.width, 48);
  assert.equal(decoded.height, 32);
  assert.equal(dhash64(decoded).toString(16), "8001818181e1e190");
  assert.equal(
    frameHash(decoded),
    "337ca0b0ee97b9531ed9f74f8aaa5cc7f3ccd9329632e75b680c0be730e07107",
  );
});

test("jpeg: encoder validates its inputs", () => {
  assert.throws(() => encodeRgbToJpeg(new Uint8Array(3), 2, 2), /length/);
  assert.throws(() => encodeRgbToJpeg(new Uint8Array(12), 0, 2), /dimensions/);
  assert.throws(() => encodeGrayToJpeg(new Uint8Array(3), 2, 2), /length/);
});
