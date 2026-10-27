import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  awbPage,
  createRng,
  generateForm,
  paperValues,
  podPage,
  renderPage,
  type SyntheticForm,
  type TypedValues,
} from "@second-look/generator";
import type { BoundingBox } from "@second-look/pipeline";

const execFileAsync = promisify(execFile);

export const CLIP_WIDTH = 720;
export const CLIP_HEIGHT = 1280;
export const CLIP_FPS = 30;
export const TITLE_SECONDS = 1.5;
export const DOC_SECONDS = 6;

export const PLACEHOLDER_NOTE =
  "SYNTHETIC PLACEHOLDER: rendered from generator PNGs, not recorded footage. " +
  "Recording real POV clips is a human task (see PLAN.md).";

/** Default ffmpeg; override with FFMPEG_BIN. */
export function ffmpegPath(): string {
  return process.env.FFMPEG_BIN ?? "/opt/homebrew/bin/ffmpeg";
}

export interface ClipSidecar {
  clip: string;
  synthetic: true;
  placeholder: string;
  formId: string;
  seed: number;
  docType: "awb" | "pod";
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  groundTruth: {
    paperValues: TypedValues;
    /**
     * Nominal boxes in clip pixels for the stub SAM path. The perspective
     * tilt and handheld jitter shift the page a few pixels per frame, so
     * these are approximate by design, not measured detections.
     */
    boxesNominal: true;
    boxes: BoundingBox[];
  };
  renderedAt: string;
}

function titleCard(docType: "awb" | "pod"): Uint8Array {
  return renderPage({
    title: "SYNTHETIC PLACEHOLDER",
    rows: [
      ["SOURCE", "GENERATOR PNG - NO CAMERA"],
      ["CLIP SHOWS", docType === "awb" ? "AIR WAYBILL PAGE" : "PROOF OF DELIVERY PAGE"],
      ["STATUS", "REAL POV CLIPS ARE A HUMAN TASK"],
      ["FORMAT", "720X1280 - SAMPLED AT 2 TO 7 FPS"],
    ],
    footer: "SECOND LOOK - SYNTHETIC - NO REAL DATA",
  });
}

function docPng(form: SyntheticForm, docType: "awb" | "pod"): Uint8Array {
  if (docType === "awb") return renderPage(awbPage(form, form.awb));
  return renderPage(podPage(form, form.pod), createRng(form.seed * 31 + 7));
}

/**
 * Nominal document + field boxes in 720x1280 clip pixels. The page renders
 * 660px wide centered, so the doc box covers it with the tilt/jitter
 * headroom folded in; field rows sit in the upper two thirds.
 */
export function nominalBoxes(): BoundingBox[] {
  return [
    { x: 24, y: 170, width: 672, height: 940 },
    { x: 60, y: 330, width: 600, height: 70 },
    { x: 60, y: 470, width: 600, height: 70 },
  ];
}

async function renderOne(
  ffmpeg: string,
  titlePng: Uint8Array,
  docPngBytes: Uint8Array,
  outPath: string,
): Promise<void> {
  const work = join(tmpdir(), `sl-clip-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  await mkdir(work, { recursive: true });
  const titleFile = join(work, "title.png");
  const docFile = join(work, "doc.png");
  await writeFile(titleFile, titlePng);
  await writeFile(docFile, docPngBytes);
  const filter =
    "[0:v]scale=720:-2,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black," +
    `setsar=1,format=yuv420p,fps=${CLIP_FPS}[title];` +
    "[1:v]scale=660:924,pad=760:1320:(ow-iw)/2:(oh-ih)/2:color=0x2a2d34," +
    "perspective=x0=16:y0=24:x1=744:y1=8:x2=24:y2=1296:x3=736:y3=1312:interpolation=linear," +
    "gblur=sigma=0.6," +
    "crop=720:1280:x='20+10*sin(2*PI*t*0.9)':y='20+8*cos(2*PI*t*1.3)'," +
    `setsar=1,format=yuv420p,fps=${CLIP_FPS}[doc];` +
    "[title][doc]concat=n=2:v=1:a=0[out]";
  try {
    await execFileAsync(ffmpeg, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-framerate",
      String(CLIP_FPS),
      "-t",
      String(TITLE_SECONDS),
      "-i",
      titleFile,
      "-loop",
      "1",
      "-framerate",
      String(CLIP_FPS),
      "-t",
      String(DOC_SECONDS),
      "-i",
      docFile,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-r",
      String(CLIP_FPS),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outPath,
    ]);
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr ?? String(error);
    throw new Error(`ffmpeg render of ${outPath} failed: ${stderr}`);
  }
}

export interface RenderSpec {
  name: string;
  seed: number;
  docType: "awb" | "pod";
}

export const RENDER_SPECS: RenderSpec[] = [
  { name: "clip-awb", seed: 901, docType: "awb" },
  { name: "clip-pod", seed: 902, docType: "pod" },
];

/**
 * Build one clip form deterministically: no random error injection, so the
 * sidecar ground truth is exactly what the E2E checks type against. The POD
 * form carries the scripted "2 cartons damaged" note plus a genuine paper
 * invoice/packing quantity gap.
 */
export function buildClipForm(spec: RenderSpec): SyntheticForm {
  const rng = createRng(spec.seed);
  const form = generateForm(`clip-${spec.docType}`, spec.seed, rng);
  if (spec.docType === "awb") {
    form.pod.exceptionNote = null;
  } else {
    form.pod.exceptionNote = "2 cartons damaged";
    form.invoice.totalQty = form.packing.totalQty - 2;
  }
  return form;
}

export async function renderClips(outDir: string, ffmpeg = ffmpegPath()): Promise<ClipSidecar[]> {
  await mkdir(outDir, { recursive: true });
  const sidecars: ClipSidecar[] = [];
  for (const spec of RENDER_SPECS) {
    const form = buildClipForm(spec);
    const outPath = join(outDir, `${spec.name}.mp4`);
    await renderOne(ffmpeg, titleCard(spec.docType), docPng(form, spec.docType), outPath);
    const sidecar: ClipSidecar = {
      clip: `${spec.name}.mp4`,
      synthetic: true,
      placeholder: PLACEHOLDER_NOTE,
      formId: form.formId,
      seed: spec.seed,
      docType: spec.docType,
      width: CLIP_WIDTH,
      height: CLIP_HEIGHT,
      fps: CLIP_FPS,
      durationSec: TITLE_SECONDS + DOC_SECONDS,
      groundTruth: {
        paperValues: paperValues(form),
        boxesNominal: true,
        boxes: nominalBoxes(),
      },
      renderedAt: new Date().toISOString(),
    };
    await writeFile(join(outDir, `${spec.name}.json`), JSON.stringify(sidecar, null, 2));
    const bytes = (await stat(outPath)).size;
    console.log(`wrote ${outPath} (${(bytes / 1024).toFixed(0)} KiB) + sidecar`);
    sidecars.push(sidecar);
  }
  console.log(PLACEHOLDER_NOTE);
  return sidecars;
}

function argValue(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out =
    argValue(args, "--out") ?? new URL("../../clips", import.meta.url).pathname;
  await renderClips(out);
}

const isMainEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainEntry) {
  await main();
}
