import type { DecodedGray } from "./frames.ts";

/**
 * Baseline JPEG grayscale decode plus a tiny baseline encoder for tests
 * and fixtures. Dependency-free: Huffman tables come from the file, the
 * encoder writes its own simple valid tables, and only the luminance (Y)
 * channel is reconstructed, which is all the hashing path needs.
 *
 * Decoder scope: 8-bit sequential DCT (SOF0/SOF1), 1 or 3 components,
 * Y sampling 1x1/2x1/1x2/2x2 with 1x1 chroma, single scan, restart
 * intervals supported. Everything else fails with a clear `jpeg:`
 * error so the caller can drop the frame.
 */

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** cos((2n+1) * k * PI / 16), shared by the forward and inverse DCT. */
const COS: number[][] = Array.from({ length: 8 }, (_, k) =>
  Array.from({ length: 8 }, (_, n) => Math.cos(((2 * n + 1) * k * Math.PI) / 16)),
);

function idct1d(input: ArrayLike<number>, out: number[], off: number, stride: number): void {
  for (let n = 0; n < 8; n++) {
    let sum = input[0]! / Math.SQRT2;
    for (let k = 1; k < 8; k++) sum += input[k]! * COS[k]![n]!;
    out[off + n * stride] = sum / 2;
  }
}

function dct1d(input: ArrayLike<number>, out: number[], off: number, stride: number): void {
  for (let k = 0; k < 8; k++) {
    let sum = 0;
    for (let n = 0; n < 8; n++) sum += input[n]! * COS[k]![n]!;
    out[off + k * stride] = k === 0 ? sum / Math.sqrt(8) : sum / 2;
  }
}

/** Separable 8x8 inverse DCT, natural order in and out. */
function idctBlock(coefs: ArrayLike<number>): number[] {
  const tmp = new Array<number>(64).fill(0);
  const row = new Array<number>(8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) row[x] = coefs[y * 8 + x]!;
    idct1d(row, tmp, y * 8, 1);
  }
  const out = new Array<number>(64).fill(0);
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) row[y] = tmp[y * 8 + x]!;
    idct1d(row, out, x, 8);
  }
  return out;
}

/** Separable 8x8 forward DCT, natural order in and out. */
function dctBlock(pixels: ArrayLike<number>): number[] {
  const tmp = new Array<number>(64).fill(0);
  const line = new Array<number>(8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) line[x] = pixels[y * 8 + x]!;
    dct1d(line, tmp, y * 8, 1);
  }
  const out = new Array<number>(64).fill(0);
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) line[y] = tmp[y * 8 + x]!;
    dct1d(line, out, x, 8);
  }
  return out;
}

function fail(message: string): never {
  throw new Error(`jpeg: ${message}`);
}

interface HuffmanTable {
  minCode: Int32Array;
  maxCode: Int32Array;
  valPtr: Int32Array;
  values: number[];
}

/** Canonical Huffman decode tables from BITS + HUFFVAL (IJG method). */
function buildHuffman(bits: number[], values: number[]): HuffmanTable {
  const minCode = new Int32Array(17).fill(0);
  const maxCode = new Int32Array(17).fill(-1);
  const valPtr = new Int32Array(17).fill(0);
  let code = 0;
  let at = 0;
  for (let len = 1; len <= 16; len++) {
    const count = bits[len - 1]!;
    if (count > 0) {
      minCode[len] = code;
      maxCode[len] = code + count - 1;
      valPtr[len] = at;
      at += count;
    }
    code = (code + count) << 1;
  }
  if (at !== values.length) fail("DHT values do not match BITS counts");
  return { minCode, maxCode, valPtr, values };
}

/** Canonical (code, length) per symbol, for the encoder. */
function buildEncoderCodes(bits: number[], values: number[]): Map<number, [number, number]> {
  const codes = new Map<number, [number, number]>();
  let code = 0;
  let at = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]!; i++) {
      codes.set(values[at++]!, [code++, len]);
    }
    code <<= 1;
  }
  return codes;
}

/** JPEG additional-bits value (RECEIVE/EXTEND semantics). */
function extend(bits: number, size: number): number {
  if (size === 0) return 0;
  return bits < 1 << (size - 1) ? bits - (1 << size) + 1 : bits;
}

function additionalBits(value: number, size: number): number {
  if (size === 0) return 0;
  return value >= 0 ? value : value + (1 << size) - 1;
}

function category(value: number): number {
  const abs = Math.abs(value);
  let size = 0;
  while ((1 << size) <= abs) size++;
  return size;
}

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
}

/** Scan bit reader with 0xFF00 unstuffing; stops at the end marker. */
class ScanReader {
  private at: number;
  private buffered = 0;
  private available = 0;
  pendingMarker = 0;

  private readonly data: Uint8Array;

  constructor(data: Uint8Array, start: number) {
    this.data = data;
    this.at = start;
  }

  private fill(): boolean {
    if (this.at >= this.data.length) fail("truncated scan data");
    const byte = this.data[this.at++]!;
    if (byte !== 0xff) {
      this.buffered = (this.buffered << 8) | byte;
      this.available += 8;
      return true;
    }
    if (this.at >= this.data.length) fail("truncated scan data");
    let marker = this.data[this.at++]!;
    while (marker === 0xff) {
      if (this.at >= this.data.length) fail("truncated scan data");
      marker = this.data[this.at++]!;
    }
    if (marker === 0x00) {
      this.buffered = (this.buffered << 8) | 0xff;
      this.available += 8;
      return true;
    }
    this.pendingMarker = marker;
    return false;
  }

  readBit(): number {
    if (this.available === 0 && !this.fill()) {
      fail("unexpected marker inside scan data");
    }
    this.available--;
    return (this.buffered >> this.available) & 1;
  }

  readBits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | this.readBit();
    return value;
  }

  decode(table: HuffmanTable): number {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | this.readBit();
      if (code >= table.minCode[len]! && code <= table.maxCode[len]!) {
        return table.values[table.valPtr[len]! + code - table.minCode[len]!]!;
      }
    }
    fail("invalid Huffman code in scan data");
  }

  /** Drop pad bits, then consume one marker; returns it. */
  private readMarker(): number {
    this.available = 0;
    if (this.pendingMarker === 0 && this.fill()) {
      fail("expected a marker, found scan data");
    }
    const marker = this.pendingMarker;
    this.pendingMarker = 0;
    return marker;
  }

  /** Consume a restart marker between intervals; fails otherwise. */
  consumeRestart(): void {
    const marker = this.readMarker();
    if (marker < 0xd0 || marker > 0xd7) fail(`expected a restart marker, got 0x${marker.toString(16)}`);
  }

  /** Drop pad bits; the scan must end at EOI. Returns bytes consumed. */
  finishScan(): number {
    const marker = this.readMarker();
    if (marker >= 0xd0 && marker <= 0xd7) fail("trailing restart marker past the last interval");
    if (marker !== 0xd9) fail("multiple scans are not supported");
    return this.at;
  }
}

interface ScanComponent {
  sof: Component;
  dc: HuffmanTable;
  ac: HuffmanTable;
}

/** Parse one DHT segment body into the DC/AC table maps. */
function parseDht(
  body: Uint8Array,
  dcTables: Map<number, HuffmanTable>,
  acTables: Map<number, HuffmanTable>,
): void {
  let pos = 0;
  while (pos < body.length) {
    const info = body[pos++]!;
    const bits = Array.from(body.subarray(pos, pos + 16));
    if (bits.length !== 16) fail("truncated DHT");
    pos += 16;
    const total = bits.reduce((sum, n) => sum + n, 0);
    const values = Array.from(body.subarray(pos, pos + total));
    if (values.length !== total) fail("truncated DHT values");
    pos += total;
    const table = buildHuffman(bits, values);
    if ((info >> 4) === 0) dcTables.set(info & 0x0f, table);
    else acTables.set(info & 0x0f, table);
  }
}

/**
 * Decode a baseline JPEG to grayscale. Only Y blocks run the IDCT;
 * chroma blocks are Huffman-skipped, which is exact for gray output.
 */
export function decodeJpegToGray(jpeg: Uint8Array): DecodedGray {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    fail("not a JPEG (bad SOI)");
  }
  const quant: number[][] = [];
  const dcTables = new Map<number, HuffmanTable>();
  const acTables = new Map<number, HuffmanTable>();
  let width = 0;
  let height = 0;
  let restartInterval = 0;
  let components: Component[] = [];
  let at = 2;

  const readU16 = (pos: number): number => {
    if (pos + 2 > jpeg.length) fail("truncated marker header");
    return (jpeg[pos]! << 8) | jpeg[pos + 1]!;
  };

  let scanAt = -1;
  let scanComponents: ScanComponent[] = [];
  while (at < jpeg.length) {
    if (jpeg[at] !== 0xff) fail(`expected marker at offset ${at}`);
    let marker = jpeg[at + 1]!;
    at += 2;
    while (marker === 0xff) {
      if (at >= jpeg.length) fail("truncated marker");
      marker = jpeg[at++]!;
    }
    if (marker === 0xd9) break; // EOI
    if (marker === 0xd8) fail("nested SOI");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // standalone
    const length = readU16(at);
    if (length < 2 || at + length > jpeg.length) fail("truncated marker segment");
    const body = jpeg.subarray(at + 2, at + length);
    at += length;
    if (marker === 0xc0 || marker === 0xc1) {
      if (body[0] !== 8) fail(`only 8-bit samples are supported, got ${body[0]}-bit`);
      height = (body[1]! << 8) | body[2]!;
      width = (body[3]! << 8) | body[4]!;
      const nf = body[5]!;
      if (nf !== 1 && nf !== 3) fail(`only 1 or 3 components are supported, got ${nf}`);
      if (body.length !== 6 + 3 * nf) fail("truncated SOF segment");
      components = [];
      for (let i = 0; i < nf; i++) {
        const sampling = body[6 + i * 3 + 1]!;
        components.push({
          id: body[6 + i * 3]!,
          h: sampling >> 4,
          v: sampling & 0x0f,
          tq: body[6 + i * 3 + 2]!,
        });
      }
      const y = components[0]!;
      if (y.h < 1 || y.h > 2 || y.v < 1 || y.v > 2) {
        fail(`unsupported Y sampling ${y.h}x${y.v}`);
      }
      for (const comp of components.slice(1)) {
        if (comp.h !== 1 || comp.v !== 1) fail("chroma subsampling beyond 4:2:0 is not supported");
      }
      if (width < 1 || height < 1 || width > 16384 || height > 16384) {
        fail(`implausible dimensions ${width}x${height}`);
      }
      if (width * height > 64 * 1024 * 1024) fail("frame exceeds the 64 MP cap");
    } else if (marker === 0xc2) {
      fail("progressive JPEG is not supported (need SOF0 baseline)");
    } else if (marker === 0xc4) {
      parseDht(body, dcTables, acTables);
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc8) {
      fail(`unsupported SOF marker 0x${marker.toString(16)}`);
    } else if (marker === 0xdb) {
      let pos = 0;
      while (pos < body.length) {
        const info = body[pos++]!;
        if ((info >> 4) !== 0) fail("only 8-bit quant tables are supported");
        const table = Array.from(body.subarray(pos, pos + 64));
        if (table.length !== 64) fail("truncated DQT");
        quant[info & 0x0f] = table;
        pos += 64;
      }
    } else if (marker === 0xdd) {
      if (body.length !== 2) fail("truncated DRI segment");
      restartInterval = (body[0]! << 8) | body[1]!;
    } else if (marker === 0xda) {
      if (components.length === 0) fail("SOS before SOF");
      const ns = body[0]!;
      if (ns < 1 || ns > components.length) fail(`SOS selects ${ns} components`);
      if (body.length !== 4 + 2 * ns) fail("truncated SOS segment");
      scanComponents = [];
      for (let i = 0; i < ns; i++) {
        const id = body[1 + i * 2]!;
        const selectors = body[1 + i * 2 + 1]!;
        const sof = components.find((c) => c.id === id);
        if (!sof) fail(`SOS references unknown component ${id}`);
        const dc = dcTables.get(selectors >> 4);
        const ac = acTables.get(selectors & 0x0f);
        if (!dc || !ac) fail("SOS references a missing Huffman table");
        scanComponents.push({ sof, dc, ac });
      }
      if (body[1 + 2 * ns] !== 0 || body[1 + 2 * ns + 1] !== 63 || body[1 + 2 * ns + 2] !== 0) {
        fail("only full sequential scans are supported");
      }
      scanAt = at;
      break;
    }
    // APPn, COM, DNL and other segments carry no decode state; skipped.
  }
  if (scanAt < 0 || scanComponents.length === 0) fail("no scan data found");

  const hMax = Math.max(...components.map((c) => c.h));
  const vMax = Math.max(...components.map((c) => c.v));
  const mcuW = Math.ceil(width / (8 * hMax));
  const mcuH = Math.ceil(height / (8 * vMax));
  const gray = new Uint8Array(width * height);
  const reader = new ScanReader(jpeg, scanAt);
  const dcPredictor = new Map<number, number>();
  const yId = components[0]!.id;
  const zigzag = new Array<number>(64);
  const natural = new Array<number>(64);

  const decodeBlock = (comp: ScanComponent, keep: boolean): void => {
    const size = reader.decode(comp.dc);
    if (size > 11) fail(`DC category ${size} exceeds 8-bit range`);
    const prev = dcPredictor.get(comp.sof.id) ?? 0;
    const dc = prev + extend(reader.readBits(size), size);
    dcPredictor.set(comp.sof.id, dc);
    if (!keep) {
      let k = 1;
      while (k < 64) {
        const rs = reader.decode(comp.ac);
        if (rs === 0x00) return;
        if (rs === 0xf0) {
          k += 16;
          continue;
        }
        k += rs >> 4;
        if (k >= 64) fail("AC run overflows the block");
        reader.readBits(rs & 0x0f);
        k++;
      }
      return;
    }
    const table = quant[comp.sof.tq];
    if (!table) fail(`missing quant table ${comp.sof.tq}`);
    zigzag.fill(0);
    zigzag[0] = dc;
    let k = 1;
    while (k < 64) {
      const rs = reader.decode(comp.ac);
      if (rs === 0x00) break;
      if (rs === 0xf0) {
        k += 16;
        continue;
      }
      k += rs >> 4;
      if (k >= 64) fail("AC run overflows the block");
      zigzag[k++] = extend(reader.readBits(rs & 0x0f), rs & 0x0f);
    }
    for (let i = 0; i < 64; i++) natural[ZIGZAG[i]!] = zigzag[i]! * table[ZIGZAG[i]!]!;
  };

  let mcuIndex = 0;
  for (let my = 0; my < mcuH; my++) {
    for (let mx = 0; mx < mcuW; mx++) {
      if (restartInterval > 0 && mcuIndex > 0 && mcuIndex % restartInterval === 0) {
        reader.consumeRestart();
        dcPredictor.clear();
      }
      mcuIndex++;
      for (const comp of scanComponents) {
        for (let by = 0; by < comp.sof.v; by++) {
          for (let bx = 0; bx < comp.sof.h; bx++) {
            const keep = comp.sof.id === yId;
            decodeBlock(comp, keep);
            if (!keep) continue;
            const pixels = idctBlock(natural);
            const ox = (mx * comp.sof.h + bx) * 8;
            const oy = (my * comp.sof.v + by) * 8;
            for (let y = 0; y < 8; y++) {
              const gy = oy + y;
              if (gy >= height) break;
              for (let x = 0; x < 8; x++) {
                const gx = ox + x;
                if (gx >= width) break;
                gray[gy * width + gx] = Math.max(
                  0,
                  Math.min(255, Math.round(pixels[y * 8 + x]! + 128)),
                );
              }
            }
          }
        }
      }
    }
  }
  reader.finishScan();
  return { width, height, gray };
}

// ---------------------------------------------------------------------------
// Tiny baseline encoder: simple valid Huffman tables, flat quant, 4:2:0.
// Only used for tests and synthetic fixtures, never on a hot path.
// ---------------------------------------------------------------------------

/** DC categories 0-11 with a short prefix code (lengths 2,2,3,3,3,4..10). */
const ENCODER_DC_BITS = [0, 2, 3, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
const ENCODER_DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * AC symbols as a flat 8-bit code: EOB, ZRL, then (run, size) run-major.
 * Wasteful but valid; fixtures stay small anyway.
 */
const ENCODER_AC_BITS = [0, 0, 0, 0, 0, 0, 0, 162, 0, 0, 0, 0, 0, 0, 0, 0];
const ENCODER_AC_VALUES: number[] = (() => {
  const values = [0x00, 0xf0];
  for (let run = 0; run < 16; run++) {
    for (let size = 1; size <= 10; size++) values.push((run << 4) | size);
  }
  return values;
})();

const ENCODER_QUANT = new Array<number>(64).fill(8);

class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private filled = 0;

  write(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.current = (this.current << 1) | ((code >> i) & 1);
      this.filled++;
      if (this.filled === 8) this.flushByte();
    }
  }

  private flushByte(): void {
    this.bytes.push(this.current);
    if (this.current === 0xff) this.bytes.push(0x00);
    this.current = 0;
    this.filled = 0;
  }

  finish(): number[] {
    if (this.filled > 0) {
      while (this.filled < 8) {
        this.current = (this.current << 1) | 1;
        this.filled++;
      }
      this.flushByte();
    }
    return this.bytes;
  }
}

function segment(marker: number, body: number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...body];
}

function rgbToYCbCr(r: number, g: number, b: number): [number, number, number] {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    -0.16874 * r - 0.33126 * g + 0.5 * b + 128,
    0.5 * r - 0.41869 * g - 0.08131 * b + 128,
  ];
}

interface EncoderTables {
  dc: Map<number, [number, number]>;
  ac: Map<number, [number, number]>;
}

function encoderTables(): EncoderTables {
  return {
    dc: buildEncoderCodes(ENCODER_DC_BITS, ENCODER_DC_VALUES),
    ac: buildEncoderCodes(ENCODER_AC_BITS, ENCODER_AC_VALUES),
  };
}

/** Quantized zigzag-order coefficients for one 8x8 block. */
function encodeBlock(pixels: ArrayLike<number>): number[] {
  const shifted = Array.from({ length: 64 }, (_, i) => pixels[i]! - 128);
  const coefs = dctBlock(shifted);
  const zz = new Array<number>(64);
  for (let i = 0; i < 64; i++) {
    zz[i] = Math.round(coefs[ZIGZAG[i]!]! / ENCODER_QUANT[ZIGZAG[i]!]!);
  }
  return zz;
}

function writeBlock(writer: BitWriter, tables: EncoderTables, zz: number[], dcPrev: number): number {
  const dcCode = tables.dc.get(category(zz[0]! - dcPrev))!;
  writer.write(dcCode[0], dcCode[1]);
  const size = category(zz[0]! - dcPrev);
  if (size > 0) writer.write(additionalBits(zz[0]! - dcPrev, size), size);
  let run = 0;
  for (let k = 1; k < 64; k++) {
    if (zz[k] === 0) {
      run++;
      continue;
    }
    while (run >= 16) {
      const zrl = tables.ac.get(0xf0)!;
      writer.write(zrl[0], zrl[1]);
      run -= 16;
    }
    const rs = (run << 4) | category(zz[k]!);
    const code = tables.ac.get(rs);
    if (!code) fail(`encoder cannot emit AC symbol 0x${rs.toString(16)}`);
    writer.write(code[0], code[1]);
    writer.write(additionalBits(zz[k]!, category(zz[k]!)), category(zz[k]!));
    run = 0;
  }
  if (run > 0) {
    const eob = tables.ac.get(0x00)!;
    writer.write(eob[0], eob[1]);
  }
  return zz[0]!;
}

function encoderHeaders(width: number, height: number, gray: boolean): number[] {
  const out: number[] = [0xff, 0xd8];
  const dqt = gray ? [0x00, ...ENCODER_QUANT] : [0x00, ...ENCODER_QUANT, 0x01, ...ENCODER_QUANT];
  out.push(...segment(0xdb, dqt));
  if (gray) {
    out.push(
      ...segment(0xc0, [
        8,
        (height >> 8) & 0xff,
        height & 0xff,
        (width >> 8) & 0xff,
        width & 0xff,
        1,
        1,
        0x11,
        0x00,
      ]),
    );
  } else {
    out.push(
      ...segment(0xc0, [
        8,
        (height >> 8) & 0xff,
        height & 0xff,
        (width >> 8) & 0xff,
        width & 0xff,
        3,
        1,
        0x22,
        0x00,
        2,
        0x11,
        0x01,
        3,
        0x11,
        0x01,
      ]),
    );
  }
  out.push(...segment(0xc4, [0x00, ...ENCODER_DC_BITS, ...ENCODER_DC_VALUES]));
  out.push(...segment(0xc4, [0x10, ...ENCODER_AC_BITS, ...ENCODER_AC_VALUES]));
  if (gray) {
    out.push(...segment(0xda, [1, 1, 0x00, 0, 63, 0]));
  } else {
    out.push(...segment(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]));
  }
  return out;
}

/** Sample a planar channel with edge replication past the borders. */
function samplePlane(plane: number[], width: number, height: number, x: number, y: number): number {
  const cx = Math.max(0, Math.min(width - 1, x));
  const cy = Math.max(0, Math.min(height - 1, y));
  return plane[cy * width + cx]!;
}

function blockPixels(
  plane: number[],
  width: number,
  height: number,
  ox: number,
  oy: number,
): number[] {
  const pixels = new Array<number>(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) pixels[y * 8 + x] = samplePlane(plane, width, height, ox + x, oy + y);
  }
  return pixels;
}

/**
 * Encode RGB bytes (row-major, 3 per pixel) as a baseline 4:2:0 JPEG.
 * Quality is fixed (flat quant 8): fixtures and round-trip tests only.
 */
export function encodeRgbToJpeg(rgb: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    fail(`bad dimensions ${width}x${height}`);
  }
  if (rgb.length !== width * height * 3) fail("RGB length does not match dimensions");
  const yPlane: number[] = new Array(width * height);
  const cbFull: number[] = new Array(width * height);
  const crFull: number[] = new Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const [y, cb, cr] = rgbToYCbCr(rgb[p * 3]!, rgb[p * 3 + 1]!, rgb[p * 3 + 2]!);
    yPlane[p] = y;
    cbFull[p] = cb;
    crFull[p] = cr;
  }
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const cbPlane = new Array<number>(cw * ch);
  const crPlane = new Array<number>(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let cb = 0;
      let cr = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(width - 1, x * 2 + dx);
          const sy = Math.min(height - 1, y * 2 + dy);
          cb += cbFull[sy * width + sx]!;
          cr += crFull[sy * width + sx]!;
        }
      }
      cbPlane[y * cw + x] = cb / 4;
      crPlane[y * cw + x] = cr / 4;
    }
  }
  const tables = encoderTables();
  const writer = new BitWriter();
  let dcY = 0;
  let dcCb = 0;
  let dcCr = 0;
  const mcuW = Math.ceil(width / 16);
  const mcuH = Math.ceil(height / 16);
  for (let my = 0; my < mcuH; my++) {
    for (let mx = 0; mx < mcuW; mx++) {
      for (let by = 0; by < 2; by++) {
        for (let bx = 0; bx < 2; bx++) {
          dcY = writeBlock(
            writer,
            tables,
            encodeBlock(blockPixels(yPlane, width, height, mx * 16 + bx * 8, my * 16 + by * 8)),
            dcY,
          );
        }
      }
      dcCb = writeBlock(
        writer,
        tables,
        encodeBlock(blockPixels(cbPlane, cw, ch, mx * 8, my * 8)),
        dcCb,
      );
      dcCr = writeBlock(
        writer,
        tables,
        encodeBlock(blockPixels(crPlane, cw, ch, mx * 8, my * 8)),
        dcCr,
      );
    }
  }
  return Uint8Array.from([...encoderHeaders(width, height, false), ...writer.finish(), 0xff, 0xd9]);
}

/** Encode grayscale bytes (row-major) as a single-component baseline JPEG. */
export function encodeGrayToJpeg(gray: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    fail(`bad dimensions ${width}x${height}`);
  }
  if (gray.length !== width * height) fail("gray length does not match dimensions");
  const plane = Array.from(gray);
  const tables = encoderTables();
  const writer = new BitWriter();
  let dc = 0;
  for (let my = 0; my < Math.ceil(height / 8); my++) {
    for (let mx = 0; mx < Math.ceil(width / 8); mx++) {
      dc = writeBlock(writer, tables, encodeBlock(blockPixels(plane, width, height, mx * 8, my * 8)), dc);
    }
  }
  return Uint8Array.from([...encoderHeaders(width, height, true), ...writer.finish(), 0xff, 0xd9]);
}
