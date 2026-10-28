import {
  checkCrossDoc,
  createPipelineAdapters,
  decodeJpegToGray,
  decodePngToGray,
  dhash64,
  frameHash,
  hammingDistance,
  reduceVerdict,
  type PipelineAdapters,
} from "@second-look/pipeline";
import type { LiveVerdictFailure } from "./live-verdict.ts";
import { publishLiveVerdict } from "./verdict-bus.ts";

/**
 * Live-glasses frame path. The Android app posts JPEG frames as data URLs
 * in `frame.pov` events; this module validates, dedupes, throttles, and
 * judges them through the vision path (Spark boxes, abstention gate,
 * judge), publishing verdicts on the same SSE stream as text events.
 */

export const FRAME_FIELD_ID = "frame.pov";

/** Decoded-byte cap: the data URL stays well under Vercel's 4.5 MB body limit. */
export const MAX_FRAME_BYTES = 2_000_000;

/** Min dhash bits changed since the last judged keyframe; matches selectKeyframes. */
export const FRAME_CHANGE_THRESHOLD = 8;

/** Rolling per-session budget for frame-driven model calls. */
export const MAX_FRAME_MODEL_CALLS_PER_MIN = 10;
const FRAME_CALL_WINDOW_MS = 60_000;

/** One judged keyframe costs two calls: boxes plus the judge. */
export const FRAME_MODEL_CALLS_PER_CHECK = 2;

export const FRAME_CONCEPT = "shipping document";

/** Tighter Spark output cap for frame checks; the verdict JSON is small. */
export const FRAME_SPARK_MAX_TOKENS = 768;

export const FRAME_JUDGE_QUESTION = [
  "Frame judge: read every field's PAPER value from the attached POV frame,",
  "then compare against the TYPED readings below.",
  "Flag when: (1) a readable paper value differs from its typed value, except notes;",
  "(2) any cross-document pair disagrees exactly: invoice.totalQty vs packing.totalQty,",
  "bol.weightKg vs awb.weightKg, pod.receivedCartons vs bol.cartons.",
  "Use kind field_match for (1), cross_doc for (2).",
  "When a field has no typed value, do not flag it.",
  'List fields you cannot read (blur, glare, skew) under "unreadable" instead of guessing.',
  'Also list fields you read but are unsure about under "low_confidence".',
  'Set "document" to the doc type shown (bol, awb, invoice, packing, pod, label, or unknown),',
  'and "readings" to every fieldId you read mapped to its PAPER value.',
  "Reply immediately with ONLY the JSON object.",
].join(" ");

export const FRAME_CROSSDOC_FIELD_ID = "frame.crossdoc";

/** Max document entries kept per session; oldest drops first. */
export const MAX_SESSION_DOCS = 6;

/** Max stored fields per document; the judge reads a handful. */
export const MAX_DOC_FIELDS = 40;

/** Sessions idle this long lose their frame memory (docs, dedupe, budget). */
export const SESSION_IDLE_MS = 30 * 60_000;

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

/** Per-session frame state: memory, last keyframe, and call budget. */
export interface SessionFrameState {
  lastDhash: bigint | null;
  callTimestamps: number[];
  documents: Map<string, SessionDocument>;
  lastSeenMs: number;
  /** Failure signature of the last cross-doc verdict; "clean" or null. */
  lastCrossDocKey: string | null;
}

const frameSessions = new Map<string, SessionFrameState>();

export function frameStateFor(sessionId: string, nowMs: number = Date.now()): SessionFrameState {
  let state = frameSessions.get(sessionId);
  if (!state) {
    state = {
      lastDhash: null,
      callTimestamps: [],
      documents: new Map(),
      lastSeenMs: nowMs,
      lastCrossDocKey: null,
    };
    frameSessions.set(sessionId, state);
  }
  state.lastSeenMs = nowMs;
  return state;
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
  if (!DOC_TYPE_PATTERN.test(type)) return false;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(readings)) {
    if (Object.keys(fields).length >= MAX_DOC_FIELDS) break;
    const fieldId = key.includes(".") ? key : `${type}.${key}`;
    fields[fieldId] = value;
  }
  if (Object.keys(fields).length === 0) return false;
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
 * plus publish; costs no model calls.
 */
export function runSessionCrossDoc(sessionId: string, state: SessionFrameState): void {
  if (state.documents.size < 2) return;
  const merged: Record<string, string> = {};
  for (const doc of state.documents.values()) Object.assign(merged, doc.fields);
  const failures = checkCrossDoc(merged, { skipMissingInputs: true }).filter((c) => !c.passed);
  const key = failures.length === 0 ? "clean" : failures.map((f) => f.fieldId).join(",");
  if (failures.length === 0 && (state.lastCrossDocKey === null || state.lastCrossDocKey === "clean")) {
    return;
  }
  state.lastCrossDocKey = key;
  publishLiveVerdict(sessionId, {
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

/** Test-only reset for the in-memory frame state. */
export function __resetFramePath(): void {
  frameSessions.clear();
}

/** True when the frame is too close to the last judged keyframe to rerun. */
export function isNearDuplicate(
  last: bigint | null,
  next: bigint,
  threshold: number = FRAME_CHANGE_THRESHOLD,
): boolean {
  return last !== null && hammingDistance(last, next) < threshold;
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
}

/**
 * Judge one kept keyframe: localize the document (Spark boxes), then run
 * the image-grounded judge over the full frame. Unreadable or unsure
 * fields abstain to needs-human instead of passing silently.
 */
export async function runFrameCheck(input: FrameCheckInput): Promise<FrameCheckResult> {
  const started = performance.now();
  const boxes = await input.adapters.sam.crop({
    image: input.image,
    concept: FRAME_CONCEPT,
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
  });
  const readings = Object.entries(input.typedValues).map(([fieldId, typedValue]) => ({
    fieldId,
    paperValue: null,
    typedValue,
  }));
  const spark = await input.adapters.spark.escalate({
    readings,
    crops: [
      {
        box: { x: 0, y: 0, width: input.frameWidth, height: input.frameHeight },
        image: input.image,
      },
    ],
    question: FRAME_JUDGE_QUESTION,
    maxOutputTokens: FRAME_SPARK_MAX_TOKENS,
  });
  const failures: LiveVerdictFailure[] = [];
  const fixes = new Map(
    spark.proposedFixes.map((fix) => [fix.fieldId, fix.paperValue]),
  );
  for (const failure of spark.judgment?.failures ?? []) {
    const entry: LiveVerdictFailure = {
      fieldId: failure.fieldId,
      rule: failure.kind,
      message: failure.detail ?? `${failure.fieldId} failed ${failure.kind}`,
    };
    const fix = fixes.get(failure.fieldId);
    if (fix !== null && fix !== undefined) entry.fix = fix;
    failures.push(entry);
  }
  for (const fieldId of spark.unreadable ?? []) {
    failures.push({
      fieldId,
      rule: "unreadable",
      message: `Could not read ${fieldId} from the frame.`,
    });
  }
  for (const fieldId of spark.lowConfidence ?? []) {
    failures.push({
      fieldId,
      rule: "low_confidence",
      message: `Unsure about ${fieldId} in the frame.`,
    });
  }
  const abstained = (spark.unreadable?.length ?? 0) + (spark.lowConfidence?.length ?? 0) > 0;
  const state: FrameVerdictState = abstained
    ? "needs-human"
    : reduceVerdict(spark.judgment?.failures ?? []).state;
  return {
    state,
    decision: state === "blocked" ? "BLOCK" : "ALLOW",
    failures,
    boxes: boxes.crops.length,
    latencyMs: performance.now() - started,
    boxesMs: boxes.latencyMs,
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
  adapters?: PipelineAdapters;
  nowMs?: number;
  onError?: (message: string, error: unknown) => void;
}

export type FramePostOutcome =
  | { outcome: "rejected"; error: FrameRejectError }
  | { outcome: "undecodable" }
  | { outcome: "duplicate" }
  | { outcome: "throttled" }
  | { outcome: "accepted"; done: Promise<FrameCheckResult | null>; decodeMs: number };

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
  const dhash = dhash64(gray);
  if (isNearDuplicate(state.lastDhash, dhash)) return { outcome: "duplicate" };
  state.lastDhash = dhash;
  if (!tryReserveFrameCalls(state, FRAME_MODEL_CALLS_PER_CHECK, nowMs)) {
    publishLiveVerdict(input.sessionId, {
      fieldId: FRAME_FIELD_ID,
      decision: "ALLOW",
      state: "throttled",
      failures: [],
      ts: new Date().toISOString(),
    });
    return { outcome: "throttled" };
  }
  const adapters = input.adapters ?? createPipelineAdapters();
  const typedValues = { ...input.typedValues };
  const hash = frameHash(gray);
  const done = runFrameCheck({
    image: parsed.frame.bytes,
    frameWidth: gray.width,
    frameHeight: gray.height,
    typedValues,
    adapters,
  }).then(
    (result) => {
      publishLiveVerdict(input.sessionId, {
        fieldId: FRAME_FIELD_ID,
        decision: result.decision,
        state: result.state,
        failures: result.failures,
        ts: new Date().toISOString(),
      });
      if (storeFrameDocument(state, result.document, result.readings, hash, Date.now())) {
        runSessionCrossDoc(input.sessionId, state);
      }
      return result;
    },
    (error: unknown) => {
      (input.onError ?? console.error)(`frame check failed (hash ${hash})`, error);
      return null;
    },
  );
  return { outcome: "accepted", done, decodeMs };
}
