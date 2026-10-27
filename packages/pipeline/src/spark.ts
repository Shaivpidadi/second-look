import type { Crop, FieldReading } from "./types.ts";

export interface SparkEscalationInput {
  readings: FieldReading[];
  crops: Crop[];
  question: string;
}

export interface SparkEscalationOutput {
  explanation: string;
  proposedFixes: FieldReading[];
  latencyMs: number;
  costUsd: number;
}

/** Cloud escalation for disagreements only. Needs MODEL_API_KEY. */
export async function escalate(_input: SparkEscalationInput): Promise<SparkEscalationOutput> {
  throw new Error("spark.escalate: not implemented (needs MODEL_API_KEY)");
}
