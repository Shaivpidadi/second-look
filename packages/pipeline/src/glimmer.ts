import type { Crop, FieldReading } from "./types.ts";
import { requireModelApiKey } from "./key.ts";

export interface GlimmerPassInput {
  crops: Crop[];
  readings: FieldReading[];
}

export interface GlimmerPassOutput {
  outcome: "agree" | "disagree";
  reason?: string;
  /** Payload with PII redacted, safe to send to the cloud tier. */
  redacted: FieldReading[];
  latencyMs: number;
  costUsd: number;
}

/**
 * Glimmer adapter interface: a local first pass over (crop, typed) pairs
 * that answers agree/disagree and redacts PII before any cloud call.
 */
export interface GlimmerAdapter {
  readonly name: string;
  pass(input: GlimmerPassInput): Promise<GlimmerPassOutput>;
}

/**
 * Deterministic stub: disagrees when any reading has both a paper and a
 * typed value that differ (fixtures carry both); agrees otherwise, including
 * when the paper value is unknown (live form with no paper feed yet).
 * Local pass, so the estimated cost is always $0.
 */
export class StubGlimmerAdapter implements GlimmerAdapter {
  readonly name = "stub";

  async pass(input: GlimmerPassInput): Promise<GlimmerPassOutput> {
    const started = performance.now();
    const mismatched = input.readings.filter(
      (r) =>
        r.paperValue !== null && r.typedValue !== null && r.paperValue !== r.typedValue,
    );
    const outcome = mismatched.length > 0 ? "disagree" : "agree";
    const output: GlimmerPassOutput = {
      outcome,
      redacted: redactReadings(input.readings),
      latencyMs: performance.now() - started,
      costUsd: 0,
    };
    if (outcome === "disagree") {
      output.reason = `paper/typed differ on ${mismatched.map((r) => r.fieldId).join(", ")}`;
    }
    return output;
  }
}

/**
 * Real adapter: verifies gateway auth at call time, then needs local
 * weights. Weights live only under /Volumes/Crucial X9/second-look-models
 * (never the internal disk); no download happens here.
 */
export class RealGlimmerAdapter implements GlimmerAdapter {
  readonly name = "real";

  async pass(_input: GlimmerPassInput): Promise<GlimmerPassOutput> {
    requireModelApiKey();
    throw new Error(
      "glimmer: local weights are not configured (expected under " +
        "/Volumes/Crucial X9/second-look-models). Stay on the stub adapter " +
        "until the PLAN spike 3 runner exists.",
    );
  }
}

export function createGlimmerAdapter(
  kind: "stub" | "real" = "stub",
): GlimmerAdapter {
  return kind === "real" ? new RealGlimmerAdapter() : new StubGlimmerAdapter();
}

const FREETEXT_HINTS = [
  "exception",
  "note",
  "name",
  "address",
  "receiver",
  "shipper",
  "consignee",
  "remark",
  "handwriting",
];

/**
 * Whether a field id names free text (handwriting, names, notes) rather
 * than a machine identifier or count. Drives redaction and the decision to
 * skip the field in deterministic field-match checks.
 */
export function isFreeTextField(fieldId: string): boolean {
  const lower = fieldId.toLowerCase();
  return FREETEXT_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Stub redaction policy: free-text values become "[redacted]"; identifiers
 * and counts pass through unchanged so the cloud tier can still verify
 * check digits and propose fixes. Nulls stay null.
 */
export function redactReadings(readings: FieldReading[]): FieldReading[] {
  return readings.map((reading) => {
    if (!isFreeTextField(reading.fieldId)) return { ...reading };
    const redact = (value: string | null): string | null =>
      value === null || value === "" ? value : "[redacted]";
    return {
      fieldId: reading.fieldId,
      paperValue: redact(reading.paperValue),
      typedValue: redact(reading.typedValue),
    };
  });
}
