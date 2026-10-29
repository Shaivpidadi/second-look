import {
  checkCrossDoc,
  createPipelineAdapters,
  decodeJpegToGray,
  decodePngToGray,
  dhash64,
  downscaleGray,
  encodeGrayToJpeg,
  frameHash,
  inkDistance,
  inkSignature,
  reduceVerdict,
  type PipelineAdapters,
  type SamCropOutput,
} from "@second-look/pipeline";
import type { LiveVerdictFailure } from "./live-verdict.ts";
import { fieldLabel } from "./fields.ts";
import {
  classifyPaperVsTyped,
  comparePaperToTyped,
  consigneeConflict,
  isPaperMatchField,
  normalizeSigned,
  SIGNATURE_FIELD,
  signatureFailure,
  unverifiedField,
} from "./paper-match.ts";
import { processMap } from "./process-store.ts";
import { publishLiveVerdict, type PublishedVerdict } from "./verdict-bus.ts";

/**
 * Live-glasses frame path. The Android app posts JPEG frames as data URLs
 * in `frame.pov` events; this module validates, dedupes, throttles, and
 * judges them through the vision path (Spark boxes, abstention gate,
 * judge), publishing verdicts on the same SSE stream as text events.
 */

export const FRAME_FIELD_ID = "frame.pov";

/** Decoded-byte cap: the data URL stays well under Vercel's 4.5 MB body limit. */
export const MAX_FRAME_BYTES = 2_000_000;

/**
 * Max 16x16 ink distance that still counts as the same view. Corpus
 * renders: re-noised captures 0.05-0.07, 3px shift 0.51, same-type doc
 * swap 0.58, cross-type swaps 2.5+. Handheld POV clips (fake-video E2E,
 * 720x1280 with drift, tilt, blur, glare) measure 0.2-0.7 frame to frame
 * and up to 1.9 over 3.5s on the same page, while different documents
 * measure 2.7 to 25. The old 0.55 cut (plus dhash, which spans 4-17 bits
 * on one held page and 5-18 across documents) judged 5 of every 6
 * handheld frames and burned the call budget in seconds. A same-type
 * swap under this cut waits for REJUDGE_AFTER_MS.
 */
export const INK_DIFF_THRESHOLD = 2.0;

/** Same-view frames re-judge after this long without a verdict. */
export const REJUDGE_AFTER_MS = 30_000;

/**
 * Model images downscale to this long side; dedupe still uses full
 * pixels, and smaller frames pass through byte-identical. 768 lost a
 * hyphen read (PKG- read as PKG=); 1400 keeps corpus-scale documents
 * untouched while still bounding large phone frames.
 */
export const FRAME_JUDGE_LONG_SIDE = 1400;

/** Reply-contract keys that feed session document memory (no bias: placeholders). */
export const FRAME_RESPONSE_KEYS =
  ', "document": "bol|awb|invoice|packing|pod|label|unknown", "readings": {"<fieldId>": "<PAPER value>"}';

/**
 * Rolling per-session budget for frame-driven model calls. 32 (16
 * checks at 2 calls each) lets a worker sweep six documents in under
 * 20 s without the last page starving; a check costs well under a cent.
 */
export const MAX_FRAME_MODEL_CALLS_PER_MIN = 32;
const FRAME_CALL_WINDOW_MS = 60_000;

/** One judged keyframe costs two calls: boxes plus the judge. */
export const FRAME_MODEL_CALLS_PER_CHECK = 2;

export const FRAME_CONCEPT = "shipping document";

/**
 * Spark output cap for frame checks. Deliberately NOT lowered for speed:
 * the cap never hurries generation, and a truncated reply parses as
 * no-judgment, which the frame path would read as a silent clean.
 * Output stays small through the prompt's own length caps instead.
 * 768 was too tight: minimal reasoning alone spends ~500 tokens, so with
 * the wider readings list 1 in 3 replies hit the cap and came back empty
 * (fake-video E2E probe: 628, 768 (cut), 632 output tokens).
 */
export const FRAME_SPARK_MAX_TOKENS = 1536;

export const FRAME_JUDGE_QUESTION = [
  "Frame judge: read every field's PAPER value from the attached POV frame,",
  "then compare against the TYPED readings below.",
  "Flag when: (1) a readable paper value differs from its typed value, except notes;",
  "formatting is not a difference (spaces, dashes, case, printed prefixes like (00),",
  "and for company names punctuation and suffixes like Inc, LLC, Co, Ltd);",
  "a value cut off by the frame edge goes under unreadable, never a flag;",
  "(2) any cross-document pair disagrees exactly: invoice.totalQty vs packing.totalQty,",
  "bol.weightKg vs awb.weightKg, pod.receivedCartons vs bol.cartons.",
  "Use kind field_match for (1), cross_doc for (2).",
  "When a field has no typed value, do not flag it.",
  'List fields you cannot read (blur, glare, skew) under "unreadable" instead of guessing.',
  'Also list fields you read but are unsure about under "low_confidence".',
  'Set "document" to the doc type shown (bol, awb, invoice, packing, pod, label, or unknown);',
  'a computer screen or software form is not paper: set "document" to "screen" with empty "readings".',
  'Set "readings" to ONLY these keys when shown, each mapped to its PAPER value exactly as printed:',
  "awb.awbNumber, bol.bolNumber, bol.carrier, bol.consignee, awb.consignee, bol.containerNumber, label.sscc,",
  "bol.weightKg, bol.cartons, awb.weightKg, invoice.totalQty, packing.totalQty, pod.receivedCartons,",
  "pod.receiverSigned.",
  "bol.consignee and awb.consignee are the consignee company name only (first line of the Consignee box), no address.",
  'pod.receiverSigned is for a delivery receipt only: "yes" when the receiver signature line has handwriting on it,',
  '"no" when that line is blank; when the line is covered, cut off, or too blurry to tell, list pod.receiverSigned under "unreadable" instead.',
  "Omit any key not visible; never add other keys.",
  'Always fill "document" and "readings", even when there are no typed readings to compare.',
  'Keep "explanation" empty ("") when nothing is flagged, else one sentence of at most 140 characters.',
  'Keep each failure "detail" under 120 characters.',
  "Reply immediately with ONLY the JSON object.",
].join(" ");

export const FRAME_CROSSDOC_FIELD_ID = "frame.crossdoc";

/** Field id of paper-vs-typed verdicts published after a frame is judged. */
export const FRAME_PAPER_FIELD_ID = "frame.paper";

/** Max document entries kept per session; oldest drops first. */
export const MAX_SESSION_DOCS = 6;

/** Max stored fields per document; the judge reads a handful. */
export const MAX_DOC_FIELDS = 40;

/** Sessions idle this long lose their frame memory (docs, dedupe, budget). */
export const SESSION_IDLE_MS = 30 * 60_000;

/** Max JSON bytes of client-sent session memory per frame POST. */
export const MAX_MEMORY_BYTES = 8192;

/** Max length of one client-sent field value. */
export const MAX_MEMORY_VALUE = 512;

export type FrameRejectError = "bad_frame_mime" | "bad_frame_base64" | "frame_too_large";

export interface ParsedFrame {
  mime: "image/jpeg" | "image/png";
  bytes: Uint8Array;
}

const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Validate a `frame.pov` value at the boundary: data URL shape, JPEG or
 * PNG mime, strict base64, decoded size cap. Never throws.
 */
export function parseFrameDataUrl(
  value: string,
): { frame: ParsedFrame } | { error: FrameRejectError } {
  const comma = value.indexOf(",");
  const prefix = comma < 0 ? "" : value.slice(0, comma + 1);
  const body = comma < 0 ? "" : value.slice(comma + 1);
  const mime =
    prefix === "data:image/jpeg;base64,"
      ? ("image/jpeg" as const)
      : prefix === "data:image/png;base64,"
        ? ("image/png" as const)
        : null;
  if (mime === null || body.length === 0) return { error: "bad_frame_mime" };
  if (body.length > Math.ceil(MAX_FRAME_BYTES / 3) * 4) return { error: "frame_too_large" };
  if (body.length % 4 !== 0 || !BASE64_BODY.test(body)) return { error: "bad_frame_base64" };
  const bytes = Buffer.from(body, "base64");
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) {
    return { error: bytes.length === 0 ? "bad_frame_base64" : "frame_too_large" };
  }
  return { frame: { mime, bytes: new Uint8Array(bytes) } };
}

/**
 * Paper fields read from one document, keyed by doc type. No image
 * bytes: only the strings the judge reported, plus the keyframe hash
 * that produced them.
 */
export interface SessionDocument {
  docType: string;
  fields: Record<string, string>;
  hash: string;
  updatedMs: number;
}

/** Dedupe key of the last judged keyframe: structure plus ink. */
export interface FrameDedupeKey {
  dhash: bigint;
  ink: number[];
}

/** Per-session frame state: memory, last keyframe, and call budget. */
export interface SessionFrameState {
  lastKey: FrameDedupeKey | null;
  lastJudgeMs: number;
  callTimestamps: number[];
  documents: Map<string, SessionDocument>;
  lastSeenMs: number;
  /** Failure signature of the last cross-doc verdict; "clean" or null. */
  lastCrossDocKey: string | null;
  /** Failure signature of the last paper-vs-typed verdict; "clean" or null. */
  lastPaperKey: string | null;
  /** Frame judges running now; new frames skip while one is in flight. */
  inFlight: number;
  /** True after one re-judge of a view that read nothing usable. */
  emptyRetried: boolean;
  /**
   * Newest frame that arrived while a judge was in flight. It is judged
   * when that judge finishes, unless it shows the view just judged, so
   * the last page of a sweep is never lost to a slow judge.
   */
  pendingFrame: FramePostInput | null;
}

const frameSessions = processMap<string, SessionFrameState>("frame-sessions");

export function frameStateFor(sessionId: string, nowMs: number = Date.now()): SessionFrameState {
  let state = frameSessions.get(sessionId);
  if (!state) {
    state = {
      lastKey: null,
      lastJudgeMs: 0,
      callTimestamps: [],
      documents: new Map(),
      lastSeenMs: nowMs,
      lastCrossDocKey: null,
      lastPaperKey: null,
      inFlight: 0,
      emptyRetried: false,
      pendingFrame: null,
    };
    frameSessions.set(sessionId, state);
  }
  state.lastSeenMs = nowMs;
  return state;
}

/** The most recently active frame session, for a form joining the glasses. */
export interface LatestFrameSession {
  sessionId: string;
  lastSeenMs: number;
  documents: string[];
}

/**
 * The frame session that sent a frame most recently within maxAgeMs,
 * or null. The form uses it to join the phone's session, so paper the
 * glasses read and values typed on the form are compared in one place.
 */
export function latestFrameSession(
  nowMs: number = Date.now(),
  maxAgeMs: number = SESSION_IDLE_MS,
): LatestFrameSession | null {
  let latest: LatestFrameSession | null = null;
  for (const [sessionId, state] of frameSessions) {
    if (nowMs - state.lastSeenMs > maxAgeMs) continue;
    if (latest === null || state.lastSeenMs > latest.lastSeenMs) {
      latest = { sessionId, lastSeenMs: state.lastSeenMs, documents: [...state.documents.keys()] };
    }
  }
  return latest;
}

/** Drop sessions idle past SESSION_IDLE_MS; returns the dropped count. */
export function pruneFrameSessions(nowMs: number = Date.now()): number {
  let dropped = 0;
  for (const [sessionId, state] of frameSessions) {
    if (nowMs - state.lastSeenMs > SESSION_IDLE_MS) {
      frameSessions.delete(sessionId);
      dropped++;
    }
  }
  return dropped;
}

const DOC_TYPE_PATTERN = /^[a-z0-9-]{1,24}$/;

/**
 * Paper document types session memory accepts. "unknown" and "screen"
 * stay out: a glance at the form on a monitor would otherwise store the
 * typed (possibly wrong) values as paper and mask the mismatch.
 */
export const PAPER_DOC_TYPES = new Set(["bol", "awb", "invoice", "packing", "pod", "label"]);

/** Numeric paper fields: stored as bare integers ("2,064 kg" -> "2064"). */
const NUMERIC_FIELD = /\.(weightKg|cartons|totalQty|receivedCartons|pieces)$/;

/** Normalize one paper reading for storage; numeric fields keep digits only. */
export function normalizePaperReading(fieldId: string, value: string): string {
  const trimmed = value.trim();
  if (fieldId === SIGNATURE_FIELD) return normalizeSigned(trimmed) ?? trimmed;
  if (!NUMERIC_FIELD.test(fieldId)) return trimmed;
  const match = /\d[\d,]*/.exec(trimmed);
  return match ? match[0].replace(/,/g, "") : trimmed;
}

/**
 * Store one judged document's paper fields, refreshing its slot. Bare
 * field names gain the doc-type prefix so validator pairs still match.
 * Oldest entries drop past MAX_SESSION_DOCS; returns false without
 * storing when the doc type or readings are unusable.
 */
export function storeFrameDocument(
  state: SessionFrameState,
  docType: string | undefined,
  readings: Record<string, string> | undefined,
  hash: string,
  nowMs: number,
): boolean {
  if (docType === undefined || readings === undefined) return false;
  const type = docType.trim().toLowerCase();
  if (!DOC_TYPE_PATTERN.test(type) || !PAPER_DOC_TYPES.has(type)) return false;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(readings)) {
    if (Object.keys(fields).length >= MAX_DOC_FIELDS) break;
    const fieldId = key.includes(".") ? key : `${type}.${key}`;
    fields[fieldId] = normalizePaperReading(fieldId, value);
  }
  if (Object.keys(fields).length === 0) return false;
  // A later view of the same receipt that missed the signature line
  // keeps what an earlier view read, instead of forgetting it.
  const previous = state.documents.get(type);
  if (previous !== undefined && fields[SIGNATURE_FIELD] === undefined && previous.fields[SIGNATURE_FIELD] !== undefined) {
    fields[SIGNATURE_FIELD] = previous.fields[SIGNATURE_FIELD];
  }
  state.documents.delete(type);
  state.documents.set(type, { docType: type, fields, hash, updatedMs: nowMs });
  while (state.documents.size > MAX_SESSION_DOCS) {
    const oldest = state.documents.keys().next();
    if (oldest.done) break;
    state.documents.delete(oldest.value);
  }
  return true;
}

/**
 * Run the cross-document validator over everything the session has
 * seen. Publishes a conflict verdict when pairs disagree, a clean one
 * when a past conflict resolves, and nothing otherwise. Pure lookup
 * plus publish; costs no model calls. Returns what it published.
 */
export function runSessionCrossDoc(
  sessionId: string,
  state: SessionFrameState,
): PublishedVerdict | null {
  if (state.documents.size < 2) return null;
  const merged: Record<string, string> = {};
  for (const doc of state.documents.values()) Object.assign(merged, doc.fields);
  const failures: Array<{ fieldId: string; kind: string; detail?: string }> = checkCrossDoc(merged, {
    skipMissingInputs: true,
  }).filter((c) => !c.passed);
  const consignee = consigneeConflict(merged);
  if (consignee !== null) failures.push({ fieldId: consignee.fieldId, kind: consignee.rule, detail: consignee.message });
  const key = failures.length === 0 ? "clean" : failures.map((f) => f.fieldId).join(",");
  if (failures.length === 0 && (state.lastCrossDocKey === null || state.lastCrossDocKey === "clean")) {
    return null;
  }
  state.lastCrossDocKey = key;
  return publishLiveVerdict(sessionId, {
    fieldId: FRAME_CROSSDOC_FIELD_ID,
    decision: "ALLOW",
    state: failures.length === 0 ? "clean" : "mismatch",
    failures: failures.map((failure) => ({
      fieldId: failure.fieldId,
      rule: failure.kind,
      message: failure.detail ?? `${failure.fieldId} differs between documents`,
    })),
    ts: new Date().toISOString(),
  });
}

/**
 * Paper values the session has read, flattened by field id. A field read
 * on its own document (bol.cartons on the BOL) wins over the same field
 * read elsewhere (shipped cartons on the POD). Never creates state.
 */
export function sessionDocTypes(sessionId: string): Set<string> {
  return new Set(frameSessions.get(sessionId)?.documents.keys() ?? []);
}

export function sessionPaperValues(sessionId: string): Record<string, string> {
  const state = frameSessions.get(sessionId);
  if (!state) return {};
  return mergedPaper(state);
}

function mergedPaper(state: SessionFrameState): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const doc of state.documents.values()) {
    for (const [fieldId, value] of Object.entries(doc.fields)) {
      if (!fieldId.startsWith(`${doc.docType}.`)) merged[fieldId] ??= value;
    }
  }
  for (const doc of state.documents.values()) {
    for (const [fieldId, value] of Object.entries(doc.fields)) {
      if (fieldId.startsWith(`${doc.docType}.`)) merged[fieldId] = value;
    }
  }
  return merged;
}

/**
 * Compare session paper memory with the typed values the frame was
 * judged against. Publishes a blocked verdict naming each typed field
 * that contradicts the paper (fix: the paper value), a clean one when a
 * past conflict resolves, nothing otherwise. No model calls.
 */
export function runSessionPaperMatch(
  sessionId: string,
  state: SessionFrameState,
  typedValues: Record<string, string>,
): PublishedVerdict | null {
  const paper = mergedPaper(state);
  const mismatches = comparePaperToTyped(paper, typedValues);
  // Typed fields whose document is in view but whose value was not
  // readable abstain, so silence never stands in for "matches paper".
  const seen = new Set(state.documents.keys());
  const unverified = Object.entries(typedValues)
    .map(([fieldId, typed]) => unverifiedField(fieldId, typed, paper, seen, fieldLabel(fieldId)))
    .filter((u) => u !== null);
  // The receiver signature is checked on the paper alone: a blank line
  // blocks, an unreadable one goes to a human.
  const signature = signatureFailure(paper, seen);
  const blocking = mismatches.length > 0 || signature?.rule === "missing_signature";
  const failures = [...mismatches, ...unverified, ...(signature ? [signature] : [])];
  const key =
    failures.length === 0
      ? "clean"
      : failures.map((f) => `${f.fieldId}=${"fix" in f ? f.fix : f.rule}`).join(",");
  if (key === state.lastPaperKey || (failures.length === 0 && state.lastPaperKey === null)) return null;
  state.lastPaperKey = key;
  return publishLiveVerdict(sessionId, {
    fieldId: FRAME_PAPER_FIELD_ID,
    decision: blocking ? "BLOCK" : "ALLOW",
    state: blocking ? "blocked" : failures.length > 0 ? "needs-human" : "clean",
    failures,
    ts: new Date().toISOString(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate client-sent session memory: `{ docType: { field: value } }`,
 * extracted fields only, size-capped. Absent memory is valid and empty;
 * anything malformed is rejected (the frame still judges, cross-doc
 * may miss, and the response says memoryAccepted: false).
 */
export function parseClientMemory(
  value: unknown,
): { docs: Record<string, Record<string, string>> } | { error: "bad_frame_memory" } {
  if (value === undefined) return { docs: {} };
  let size = 0;
  try {
    size = JSON.stringify(value)?.length ?? 0;
  } catch {
    return { error: "bad_frame_memory" };
  }
  if (size === 0 || size > MAX_MEMORY_BYTES) return { error: "bad_frame_memory" };
  if (!isRecord(value)) return { error: "bad_frame_memory" };
  const entries = Object.entries(value);
  if (entries.length > MAX_SESSION_DOCS) return { error: "bad_frame_memory" };
  const docs: Record<string, Record<string, string>> = {};
  for (const [type, fields] of entries) {
    if (!DOC_TYPE_PATTERN.test(type) || !isRecord(fields)) return { error: "bad_frame_memory" };
    const fieldEntries = Object.entries(fields);
    if (fieldEntries.length > MAX_DOC_FIELDS) return { error: "bad_frame_memory" };
    docs[type] = {};
    for (const [fieldId, fieldValue] of fieldEntries) {
      if (
        typeof fieldId !== "string" ||
        fieldId.length === 0 ||
        fieldId.length > 64 ||
        typeof fieldValue !== "string" ||
        fieldValue.length === 0 ||
        fieldValue.length > MAX_MEMORY_VALUE
      ) {
        return { error: "bad_frame_memory" };
      }
      docs[type]![fieldId] = fieldValue;
    }
  }
  return { docs };
}

/**
 * Merge client memory into session state, filling only doc types the
 * instance has not seen itself (in-process memory is fresher).
 */
export function mergeClientMemory(
  state: SessionFrameState,
  docs: Record<string, Record<string, string>>,
  nowMs: number,
): void {
  for (const [type, fields] of Object.entries(docs)) {
    if (state.documents.has(type)) continue;
    storeFrameDocument(state, type, fields, "", nowMs);
  }
}

/** Test-only reset for the in-memory frame state. */
export function __resetFramePath(): void {
  frameSessions.clear();
}

/**
 * True when the frame shows the same view as the last judged keyframe,
 * by 16x16 ink distance. dhash is not used here: on handheld POV it
 * moves 4-17 bits on one held page and 5-18 across different pages, so
 * it separates nothing (see INK_DIFF_THRESHOLD).
 */
export function isNearDuplicate(
  last: FrameDedupeKey | null,
  next: FrameDedupeKey,
  inkThreshold: number = INK_DIFF_THRESHOLD,
): boolean {
  return last !== null && inkDistance(last.ink, next.ink) < inkThreshold;
}

function pruneCalls(state: SessionFrameState, nowMs: number): void {
  state.callTimestamps = state.callTimestamps.filter((ts) => nowMs - ts < FRAME_CALL_WINDOW_MS);
}

/**
 * Reserve call budget for one frame check. Returns false without
 * reserving when the session already spent its rolling window.
 */
export function tryReserveFrameCalls(
  state: SessionFrameState,
  calls: number,
  nowMs: number,
): boolean {
  pruneCalls(state, nowMs);
  if (state.callTimestamps.length + calls > MAX_FRAME_MODEL_CALLS_PER_MIN) return false;
  for (let i = 0; i < calls; i++) state.callTimestamps.push(nowMs);
  return true;
}

export type FrameVerdictState = "clean" | "mismatch" | "blocked" | "needs-human";

export interface FrameCheckResult {
  state: FrameVerdictState;
  decision: "ALLOW" | "BLOCK";
  failures: LiveVerdictFailure[];
  /** Boxes the localizer returned; audit provenance, not crops. */
  boxes: number;
  /** True when the localizer was skipped for a re-judged frame. */
  boxesSkipped: boolean;
  latencyMs: number;
  /** Stage split for latency work: localizer ms and judge ms. */
  boxesMs: number;
  judgeMs: number;
  /** Document type and paper readings the judge reported, if any. */
  document?: string;
  readings?: Record<string, string>;
}

export interface FrameCheckInput {
  image: Uint8Array;
  frameWidth: number;
  frameHeight: number;
  typedValues: Record<string, string>;
  adapters: PipelineAdapters;
  /** Skip the localizer when this exact frame was judged before. */
  skipBoxes?: boolean;
  /** Called when the localizer fails; the judge verdict still publishes. */
  onBoxesError?: (error: unknown) => void;
}

/**
 * Judge one kept keyframe: localize the document (Spark boxes) and run
 * the image-grounded judge over the full frame, concurrently: the
 * judge never waits for boxes (they are audit provenance). Unreadable
 * or unsure fields abstain to needs-human instead of passing silently.
 */
export async function runFrameCheck(input: FrameCheckInput): Promise<FrameCheckResult> {
  const started = performance.now();
  const readings = Object.entries(input.typedValues).map(([fieldId, typedValue]) => ({
    fieldId,
    paperValue: null,
    typedValue,
  }));
  const boxesPromise = input.skipBoxes
    ? Promise.resolve(null)
    : input.adapters.sam.crop({
        image: input.image,
        concept: FRAME_CONCEPT,
        frameWidth: input.frameWidth,
        frameHeight: input.frameHeight,
      });
  const judgePromise = input.adapters.spark.escalate({
    readings,
    crops: [
      {
        box: { x: 0, y: 0, width: input.frameWidth, height: input.frameHeight },
        image: input.image,
      },
    ],
    question: FRAME_JUDGE_QUESTION,
    maxOutputTokens: FRAME_SPARK_MAX_TOKENS,
    responseKeys: FRAME_RESPONSE_KEYS,
  });
  const [boxesSettled, judgeSettled] = await Promise.allSettled([boxesPromise, judgePromise]);
  if (judgeSettled.status === "rejected") throw judgeSettled.reason;
  const spark = judgeSettled.value;
  let boxes: SamCropOutput | null = null;
  if (boxesSettled.status === "fulfilled") {
    boxes = boxesSettled.value;
  } else if (!input.skipBoxes) {
    input.onBoxesError?.(boxesSettled.reason);
  }
  const failures: LiveVerdictFailure[] = [];
  const fixes = new Map(
    spark.proposedFixes.map((fix) => [fix.fieldId, fix.paperValue]),
  );
  const unreadable = [...(spark.unreadable ?? [])];
  const judged: NonNullable<typeof spark.judgment>["failures"] = [];
  for (const failure of spark.judgment?.failures ?? []) {
    // The model's own reading arbitrates its field_match flags: a
    // formatting-only difference is no flag, a number clipped by the
    // frame edge is unreadable, not a mismatch.
    const paper = spark.paperReadings?.[failure.fieldId];
    const typed = input.typedValues[failure.fieldId];
    if (failure.kind === "field_match" && isPaperMatchField(failure.fieldId) && paper !== undefined && typed !== undefined) {
      const verdict = classifyPaperVsTyped(failure.fieldId, paper, typed);
      if (verdict === "match") continue;
      if (verdict === "cut-off" || verdict === "misread") {
        if (!unreadable.includes(failure.fieldId)) unreadable.push(failure.fieldId);
        continue;
      }
    }
    judged.push(failure);
  }
  for (const failure of judged) {
    const entry: LiveVerdictFailure = {
      fieldId: failure.fieldId,
      rule: failure.kind,
      message: failure.detail ?? `${failure.fieldId} failed ${failure.kind}`,
    };
    const fix = fixes.get(failure.fieldId);
    if (fix !== null && fix !== undefined) entry.fix = fix;
    failures.push(entry);
  }
  for (const fieldId of unreadable) {
    failures.push({
      fieldId,
      rule: "unreadable",
      message: `Could not read ${fieldLabel(fieldId)} from the frame.`,
    });
  }
  for (const fieldId of spark.lowConfidence ?? []) {
    failures.push({
      fieldId,
      rule: "low_confidence",
      message: `Unsure about ${fieldLabel(fieldId)} in the frame.`,
    });
  }
  // A model reply with no parseable judgment (cut off or not JSON) is
  // not a clean frame: say so, and leave the view open for the next
  // frame. Stubs report no usage and never judge, so they stay clean.
  const judgeFailed = spark.judgment === undefined && spark.usage !== undefined;
  if (judgeFailed) {
    failures.push({
      fieldId: FRAME_FIELD_ID,
      rule: "unreadable",
      message: "The check did not finish reading this frame; hold the page steady.",
    });
  }
  const abstained =
    judgeFailed || unreadable.length + (spark.lowConfidence?.length ?? 0) > 0;
  const state: FrameVerdictState = abstained
    ? "needs-human"
    : reduceVerdict(judged).state;
  return {
    state,
    decision: state === "blocked" ? "BLOCK" : "ALLOW",
    failures,
    boxes: boxes?.crops.length ?? 0,
    boxesSkipped: input.skipBoxes === true,
    latencyMs: performance.now() - started,
    boxesMs: boxes?.latencyMs ?? 0,
    judgeMs: spark.latencyMs,
    document: spark.document,
    readings: spark.paperReadings,
  };
}

export interface FramePostInput {
  sessionId: string;
  /** Raw `frame.pov` event value: a JPEG or PNG data URL. */
  value: string;
  typedValues: Record<string, string>;
  /**
   * Typed values at judge completion (the worker may type while the
   * judge runs); defaults to the snapshot in typedValues.
   */
  latestTypedValues?: () => Record<string, string>;
  /** Client-sent session memory (extracted fields, no image bytes). */
  memory?: unknown;
  adapters?: PipelineAdapters;
  nowMs?: number;
  onError?: (message: string, error: unknown) => void;
}

/** Everything one judged frame produced, for the POST response. */
export interface FramePostCompleted {
  result: FrameCheckResult;
  frameVerdict: PublishedVerdict;
  crossDocVerdict: PublishedVerdict | null;
  /** Paper-vs-typed verdict when the new paper changed the comparison. */
  paperVerdict: PublishedVerdict | null;
  memoryAccepted: boolean;
  /** Judge of a frame parked while this one ran, if one started. */
  next: Promise<FramePostCompleted | null> | null;
}

export type FramePostOutcome =
  | { outcome: "rejected"; error: FrameRejectError }
  | { outcome: "undecodable" }
  | { outcome: "duplicate"; reason: "same-view" | "busy" }
  | { outcome: "throttled"; verdict: PublishedVerdict }
  | { outcome: "accepted"; done: Promise<FramePostCompleted | null>; decodeMs: number };

/**
 * Handle one posted frame through validation, decode, dedupe, throttle,
 * and the async judge. Parse and decode run on the request path so the
 * route can answer 4xx; the judge runs off-path and publishes when done.
 * Throttled frames publish a visible throttled verdict, never a silent drop.
 */
export function handleFramePost(input: FramePostInput): FramePostOutcome {
  const nowMs = input.nowMs ?? Date.now();
  pruneFrameSessions(nowMs);
  const parsed = parseFrameDataUrl(input.value);
  if ("error" in parsed) return { outcome: "rejected", error: parsed.error };
  const decodeStarted = performance.now();
  let gray;
  try {
    gray =
      parsed.frame.mime === "image/jpeg"
        ? decodeJpegToGray(parsed.frame.bytes)
        : decodePngToGray(parsed.frame.bytes);
  } catch {
    return { outcome: "undecodable" };
  }
  const decodeMs = performance.now() - decodeStarted;
  const state = frameStateFor(input.sessionId, nowMs);
  const key: FrameDedupeKey = { dhash: dhash64(gray), ink: inkSignature(gray) };
  if (
    isNearDuplicate(state.lastKey, key) &&
    nowMs - state.lastJudgeMs < REJUDGE_AFTER_MS
  ) {
    return { outcome: "duplicate", reason: "same-view" };
  }
  // One judge at a time per session: a 2 fps stream would otherwise
  // stack a judge per frame while the first is still reading the page.
  // The newest skipped frame is parked and judged next.
  if (state.inFlight > 0) {
    state.pendingFrame = { ...input, nowMs: input.nowMs === undefined ? undefined : nowMs };
    return { outcome: "duplicate", reason: "busy" };
  }
  const hash = frameHash(gray);
  // Client memory fills gaps first, so a fresh instance still runs
  // cross-doc checks; in-process memory wins on conflicts.
  const memory = parseClientMemory(input.memory);
  const memoryAccepted = !("error" in memory);
  if (!("error" in memory)) mergeClientMemory(state, memory.docs, nowMs);
  // Re-shown documents skip the localizer: boxes are audit provenance,
  // and this exact frame was already localized once.
  let skipBoxes = [...state.documents.values()].some((doc) => doc.hash === hash);
  let reserved = tryReserveFrameCalls(state, skipBoxes ? 1 : FRAME_MODEL_CALLS_PER_CHECK, nowMs);
  // Tight budget: drop the localizer (audit provenance only) before
  // dropping the verdict.
  if (!reserved && !skipBoxes) {
    skipBoxes = true;
    reserved = tryReserveFrameCalls(state, 1, nowMs);
  }
  if (!reserved) {
    // lastKey stays on the last judged view, so this page is judged as
    // soon as budget frees instead of deduping against a throttled frame.
    const verdict = publishLiveVerdict(input.sessionId, {
      fieldId: FRAME_FIELD_ID,
      decision: "ALLOW",
      state: "throttled",
      failures: [],
      ts: new Date().toISOString(),
    });
    return { outcome: "throttled", verdict };
  }
  state.lastKey = key;
  state.inFlight += 1;
  // The model sees a downscaled gray JPEG: fewer image tokens, same
  // verdicts (see STATUS.md). Dedupe and memory hash full pixels.
  let modelImage = parsed.frame.bytes;
  let modelWidth = gray.width;
  let modelHeight = gray.height;
  const scaled = downscaleGray(gray, FRAME_JUDGE_LONG_SIDE);
  if (scaled !== gray) {
    modelImage = encodeGrayToJpeg(scaled.gray, scaled.width, scaled.height);
    modelWidth = scaled.width;
    modelHeight = scaled.height;
  }
  const adapters = input.adapters ?? createPipelineAdapters();
  const typedValues = { ...input.typedValues };
  const onError = input.onError ?? console.error;
  /** Judge the parked frame, if any; same-view frames dedupe away. */
  const drainPending = (): Promise<FramePostCompleted | null> | null => {
    const pending = state.pendingFrame;
    state.pendingFrame = null;
    if (pending === null) return null;
    const typedNow = pending.latestTypedValues?.() ?? pending.typedValues;
    const nextPost = handleFramePost({ ...pending, typedValues: typedNow });
    return nextPost.outcome === "accepted" ? nextPost.done : null;
  };
  const done: Promise<FramePostCompleted | null> = runFrameCheck({
    image: modelImage,
    frameWidth: modelWidth,
    frameHeight: modelHeight,
    typedValues,
    adapters,
    skipBoxes,
    onBoxesError: (error) => onError(`frame boxes failed (hash ${hash})`, error),
  }).then(
    (result) => {
      state.inFlight = Math.max(0, state.inFlight - 1);
      state.lastJudgeMs = nowMs;
      const frameVerdict = publishLiveVerdict(input.sessionId, {
        fieldId: FRAME_FIELD_ID,
        decision: result.decision,
        state: result.state,
        failures: result.failures,
        ts: new Date().toISOString(),
      });
      let crossDocVerdict: PublishedVerdict | null = null;
      let paperVerdict: PublishedVerdict | null = null;
      if (storeFrameDocument(state, result.document, result.readings, hash, nowMs)) {
        crossDocVerdict = runSessionCrossDoc(input.sessionId, state);
        paperVerdict = runSessionPaperMatch(input.sessionId, state, input.latestTypedValues?.() ?? typedValues);
        state.emptyRetried = false;
      } else if (state.lastKey === key && !state.emptyRetried) {
        // Nothing usable read (no doc type or readings): give the next
        // frame of this view one more judge instead of deduping against
        // a miss. One retry only, so a blank view never loops.
        state.lastKey = null;
        state.emptyRetried = true;
      }
      const next = drainPending();
      return { result, frameVerdict, crossDocVerdict, paperVerdict, memoryAccepted, next };
    },
    (error: unknown) => {
      state.inFlight = Math.max(0, state.inFlight - 1);
      onError(`frame check failed (hash ${hash})`, error);
      void drainPending();
      return null;
    },
  );
  return { outcome: "accepted", done, decodeMs };
}
