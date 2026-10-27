import type {
  AwbDoc,
  Bol,
  CommercialInvoice,
  PackingList,
  Pod,
  SsccLabel,
  SyntheticForm,
} from "./documents.ts";
import { FONT_HEIGHT, FONT_WIDTH, glyphFor } from "./font.ts";
import { encodePng } from "./png.ts";
import { createRng, type Rng } from "./prng.ts";

export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1400;

type Color = [number, number, number];
const WHITE: Color = [255, 255, 255];
const BLACK: Color = [0, 0, 0];
const GRAY: Color = [90, 90, 90];
const INK_BLUE: Color = [24, 48, 168];

class Canvas {
  pixels: Uint8Array;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3).fill(255);
  }

  rect(x: number, y: number, w: number, h: number, [r, g, b]: Color): void {
    for (let j = y; j < y + h; j++) {
      if (j < 0 || j >= this.height) continue;
      for (let i = x; i < x + w; i++) {
        if (i < 0 || i >= this.width) continue;
        const at = (j * this.width + i) * 3;
        this.pixels[at] = r;
        this.pixels[at + 1] = g;
        this.pixels[at + 2] = b;
      }
    }
  }

  text(
    value: string,
    x: number,
    y: number,
    scale: number,
    color: Color,
  ): void {
    let cx = x;
    for (const ch of value.toUpperCase()) {
      const rows = glyphFor(ch);
      for (let gy = 0; gy < FONT_HEIGHT; gy++) {
        for (let gx = 0; gx < FONT_WIDTH; gx++) {
          if (rows[gy]![gx] === "#") {
            this.rect(cx + gx * scale, y + gy * scale, scale, scale, color);
          }
        }
      }
      cx += (FONT_WIDTH + 1) * scale;
    }
  }

  /**
   * Handwritten-style text: slanted glyphs in blue ink with a seeded
   * per-character jitter, for POD exception notes.
   */
  handText(
    value: string,
    x: number,
    y: number,
    scale: number,
    color: Color,
    rng: Rng,
  ): void {
    let cx = x;
    for (const ch of value.toUpperCase()) {
      const rows = glyphFor(ch);
      const dy = Math.floor(rng() * (scale + 1)) - Math.floor(scale / 2);
      const gap = Math.floor(rng() * 2);
      for (let gy = 0; gy < FONT_HEIGHT; gy++) {
        const slant = Math.floor(((FONT_HEIGHT - gy) * scale) / 4);
        for (let gx = 0; gx < FONT_WIDTH; gx++) {
          if (rows[gy]![gx] === "#") {
            this.rect(
              cx + gx * scale + slant,
              y + gy * scale + dy,
              scale,
              scale,
              color,
            );
          }
        }
      }
      cx += (FONT_WIDTH + 1) * scale + gap;
    }
  }

  png(): Uint8Array {
    return encodePng(this.width, this.height, this.pixels);
  }
}

export interface DocPage {
  title: string;
  rows: Array<[string, string]>;
  footer: string;
  /** Row index rendered handwritten-style (POD exception note). */
  handRow?: number;
}

const MARGIN = 48;
const MAX_CHARS = 34;

function clip(value: string): string {
  return value.length > MAX_CHARS ? value.slice(0, MAX_CHARS) : value;
}

export function renderPage(page: DocPage, handRng?: Rng): Uint8Array {
  const canvas = new Canvas(PAGE_WIDTH, PAGE_HEIGHT);
  canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, WHITE);
  canvas.rect(MARGIN - 8, MARGIN - 8, PAGE_WIDTH - 2 * MARGIN + 16, 6, BLACK);
  canvas.rect(MARGIN - 8, MARGIN - 8, 6, PAGE_HEIGHT - 2 * MARGIN + 16, BLACK);
  canvas.rect(
    PAGE_WIDTH - MARGIN + 2,
    MARGIN - 8,
    6,
    PAGE_HEIGHT - 2 * MARGIN + 16,
    BLACK,
  );
  canvas.rect(
    MARGIN - 8,
    PAGE_HEIGHT - MARGIN + 2,
    PAGE_WIDTH - 2 * MARGIN + 16,
    6,
    BLACK,
  );

  canvas.rect(MARGIN, MARGIN, PAGE_WIDTH - 2 * MARGIN, 120, BLACK);
  canvas.text(page.title, MARGIN + 28, MARGIN + 38, 4, WHITE);

  let y = MARGIN + 190;
  page.rows.forEach(([label, value], index) => {
    canvas.text(label, MARGIN + 12, y, 2, GRAY);
    if (index === page.handRow) {
      canvas.handText(
        clip(value),
        MARGIN + 12,
        y + 44,
        4,
        INK_BLUE,
        handRng ?? createRng(0),
      );
    } else {
      canvas.text(clip(value), MARGIN + 12, y + 44, 4, BLACK);
    }
    y += 128;
  });

  canvas.rect(MARGIN, PAGE_HEIGHT - MARGIN - 60, PAGE_WIDTH - 2 * MARGIN, 3, BLACK);
  canvas.text(clip(page.footer), MARGIN + 12, PAGE_HEIGHT - MARGIN - 40, 2, GRAY);
  return canvas.png();
}

export function bolPage(form: SyntheticForm, bol: Bol): DocPage {
  return {
    title: "BILL OF LADING",
    rows: [
      ["BOL NUMBER", bol.bolNumber],
      ["SHIPPER", bol.shipper],
      ["CONSIGNEE", bol.consignee],
      ["CONTAINER", bol.containerNumber],
      ["SEAL", bol.sealNumber],
      ["CARTONS", String(bol.cartons)],
      ["WEIGHT KG", String(bol.weightKg)],
      ["VESSEL", bol.vessel],
    ],
    footer: `FORM ${form.formId} SEED ${form.seed} SYNTHETIC - NO REAL DATA`,
  };
}

export function awbPage(form: SyntheticForm, awb: AwbDoc): DocPage {
  return {
    title: "AIR WAYBILL",
    rows: [
      ["AWB NUMBER", awb.awbNumber],
      ["ORIGIN", awb.origin],
      ["DESTINATION", awb.destination],
      ["PIECES", String(awb.pieces)],
      ["WEIGHT KG", String(awb.weightKg)],
    ],
    footer: `FORM ${form.formId} SEED ${form.seed} SYNTHETIC - NO REAL DATA`,
  };
}

export function invoicePage(
  form: SyntheticForm,
  invoice: CommercialInvoice,
): DocPage {
  return {
    title: "COMMERCIAL INVOICE",
    rows: [
      ["INVOICE NUMBER", invoice.invoiceNumber],
      ["BOL REF", invoice.bolRef],
      ["TOTAL QTY", String(invoice.totalQty)],
      ["AMOUNT", `${invoice.totalAmount} ${invoice.currency}`],
    ],
    footer: `FORM ${form.formId} SEED ${form.seed} SYNTHETIC - NO REAL DATA`,
  };
}

export function packingPage(form: SyntheticForm, packing: PackingList): DocPage {
  return {
    title: "PACKING LIST",
    rows: [
      ["PACKING NUMBER", packing.packingNumber],
      ["BOL REF", packing.bolRef],
      ["TOTAL QTY", String(packing.totalQty)],
      ["LINES", String(packing.lines)],
    ],
    footer: `FORM ${form.formId} SEED ${form.seed} SYNTHETIC - NO REAL DATA`,
  };
}

export function podPage(form: SyntheticForm, pod: Pod): DocPage {
  return {
    title: "PROOF OF DELIVERY",
    rows: [
      ["POD NUMBER", pod.podNumber],
      ["BOL REF", pod.bolRef],
      ["RECEIVED CARTONS", String(pod.receivedCartons)],
      ["EXCEPTION", pod.exceptionNote ?? "NONE"],
      ["RECEIVER", pod.receiver],
      ["DATE", pod.date],
    ],
    footer: `FORM ${form.formId} SEED ${form.seed} SYNTHETIC - NO REAL DATA`,
    handRow: 3,
  };
}

export function labelPage(form: SyntheticForm, label: SsccLabel): DocPage {
  return {
    title: "PALLET SSCC LABEL",
    rows: [
      ["SSCC", label.sscc],
      ["PALLET", label.palletId],
      ["CARTONS", String(label.cartons)],
    ],
    footer: `FORM ${form.formId} SEED ${form.seed} SYNTHETIC - NO REAL DATA`,
  };
}

export interface FormImages {
  bol: Uint8Array;
  awb: Uint8Array;
  invoice: Uint8Array;
  packing: Uint8Array;
  pod: Uint8Array;
  label: Uint8Array;
}

export function renderForm(form: SyntheticForm): FormImages {
  const handRng = createRng(form.seed * 31 + 7);
  return {
    bol: renderPage(bolPage(form, form.bol)),
    awb: renderPage(awbPage(form, form.awb)),
    invoice: renderPage(invoicePage(form, form.invoice)),
    packing: renderPage(packingPage(form, form.packing)),
    pod: renderPage(podPage(form, form.pod), handRng),
    label: renderPage(labelPage(form, form.label)),
  };
}
