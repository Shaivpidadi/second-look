import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
  analyzeFrames,
  decodePngToGray,
  dhash64,
  frameHash,
  hammingDistance,
  selectKeyframes,
  sharpness,
  type DecodedGray,
} from "../src/index.ts";

// Minimal test encoder (filter 0/1, 8-bit). Kept local so pipeline tests
// never reach into the generator package or the eval corpus.
function crc32(data: Uint8Array): number {
  let table = CRC_TABLE;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table.push(c >>> 0);
    }
    CRC_TABLE = table;
  }
  let c = 0xffffffff;
  for (const byte of data) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
let CRC_TABLE: number[] | null = null;

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat([...data]));
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

function testPng(
  width: number,
  height: number,
  colorType: 0 | 2 | 6,
  pixels: Uint8Array,
  filter = 0,
): Uint8Array {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  const raw = new Uint8Array(height * (1 + width * channels));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * channels)] = filter;
    const row = pixels.subarray(y * width * channels, (y + 1) * width * channels);
    if (filter === 0) {
      raw.set(row, y * (1 + width * channels) + 1);
    } else {
      // Sub filter: store each byte minus the byte `channels` back.
      for (let i = 0; i < row.length; i++) {
        const a = i >= channels ? row[i - channels]! : 0;
        raw[y * (1 + width * channels) + 1 + i] = (row[i]! - a) & 0xff;
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function grayImage(width: number, height: number, fill: (x: number, y: number) => number): DecodedGray {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) gray[y * width + x] = fill(x, y);
  }
  return { width, height, gray };
}

describe("decodePngToGray", () => {
  it("decodes RGB, RGBA, and grayscale pixels", () => {
    const rgb = testPng(2, 1, 2, new Uint8Array([255, 0, 0, 0, 0, 255]));
    assert.deepEqual([...decodePngToGray(rgb).gray], [76, 29]);
    const rgba = testPng(1, 1, 6, new Uint8Array([0, 255, 0, 128]));
    assert.deepEqual([...decodePngToGray(rgba).gray], [150]);
    const gray = testPng(2, 1, 0, new Uint8Array([7, 200]));
    assert.deepEqual([...decodePngToGray(gray).gray], [7, 200]);
  });

  it("reverses Sub filtering", () => {
    const png = testPng(4, 2, 0, new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]), 1);
    assert.deepEqual([...decodePngToGray(png).gray], [10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it("rejects non-PNG and truncated input", () => {
    assert.throws(() => decodePngToGray(new Uint8Array([1, 2, 3])), /not a PNG/);
    const png = testPng(2, 2, 0, new Uint8Array([1, 2, 3, 4]));
    assert.throws(() => decodePngToGray(png.subarray(0, 20)), /truncated|missing/);
  });
});

describe("sharpness", () => {
  it("scores edges above flat fills", () => {
    const checker = grayImage(16, 16, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));
    const flat = grayImage(16, 16, () => 128);
    assert.ok(sharpness(checker) > sharpness(flat));
    assert.equal(sharpness(flat), 0);
  });
});

describe("dhash64", () => {
  it("matches identical images and separates inverses", () => {
    const left = grayImage(64, 64, (x) => Math.floor((x * 255) / 63));
    const same = grayImage(64, 64, (x) => Math.floor((x * 255) / 63));
    const inverse = grayImage(64, 64, (x) => 255 - Math.floor((x * 255) / 63));
    assert.equal(hammingDistance(dhash64(left), dhash64(same)), 0);
    assert.equal(hammingDistance(dhash64(left), dhash64(inverse)), 64);
  });
});

describe("frameHash", () => {
  it("is stable per image and differs across images", () => {
    const a = grayImage(64, 64, (x, y) => (x + y) % 256);
    const b = grayImage(64, 64, (x, y) => (x + y) % 256);
    const c = grayImage(64, 64, () => 0);
    assert.equal(frameHash(a), frameHash(b));
    assert.notEqual(frameHash(a), frameHash(c));
    assert.match(frameHash(a), /^[0-9a-f]{64}$/);
  });
});

describe("selectKeyframes", () => {
  function analysis(index: number, dhash: bigint, sharp = 1): {
    index: number;
    sharpness: number;
    dhash: bigint;
    hash: string;
  } {
    return { index, sharpness: sharp, dhash, hash: String(index) };
  }

  it("always keeps frame 0 and picks changed frames", () => {
    const frames = [
      analysis(0, 0n),
      analysis(1, 0n),
      analysis(2, 0xffn),
      analysis(3, 0xffn),
      analysis(4, 0xffffn),
    ];
    assert.deepEqual(selectKeyframes(frames, { maxKeyframes: 10, changeThreshold: 4 }), [0, 2, 4]);
  });

  it("caps to frame 0 plus the sharpest picks", () => {
    const frames = [
      analysis(0, 0n, 1),
      analysis(1, 0xffn, 5),
      analysis(2, 0xffffn, 9),
      analysis(3, 0xffffffn, 2),
    ];
    assert.deepEqual(selectKeyframes(frames, { maxKeyframes: 2, changeThreshold: 4 }), [0, 2]);
  });

  it("handles empty input and rejects bad caps", () => {
    assert.deepEqual(selectKeyframes([]), []);
    assert.throws(() => selectKeyframes([analysis(0, 0n)], { maxKeyframes: 0 }), />= 1/);
  });
});

describe("analyzeFrames", () => {
  it("decodes and scores each PNG", () => {
    const flat = testPng(8, 8, 0, new Uint8Array(64).fill(200));
    const edge = testPng(
      8,
      8,
      0,
      new Uint8Array(64).map((_, i) => (i % 8 < 4 ? 0 : 255)),
    );
    const [a, b] = analyzeFrames([flat, edge]);
    assert.equal(a?.index, 0);
    assert.equal(a?.sharpness, 0);
    assert.ok((b?.sharpness ?? 0) > 0);
    assert.notEqual(a?.hash, b?.hash);
  });
});
