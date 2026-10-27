import type { Crop, FieldReading } from "./types.ts";

export interface GlimmerPassInput {
  crops: Crop[];
  readings: FieldReading[];
}

export interface GlimmerPassOutput {
  outcome: "agree" | "disagree";
  reason?: string;
  /** Payload with PII redacted, safe to send to the cloud tier. */
  redacted: FieldReading[];
}

/** Local first pass: match/flag plus PII redaction. Needs local weights. */
export async function localPass(_input: GlimmerPassInput): Promise<GlimmerPassOutput> {
  throw new Error("glimmer.localPass: not implemented (needs local weights)");
}
