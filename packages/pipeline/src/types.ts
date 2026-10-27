export type SessionState = "clean" | "mismatch" | "blocked";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Crop {
  box: BoundingBox;
  image: Uint8Array;
}

export interface FieldReading {
  fieldId: string;
  paperValue: string | null;
  typedValue: string | null;
}

export interface FieldCheck {
  fieldId: string;
  kind: "check_digit" | "field_match" | "cross_doc";
  passed: boolean;
  detail?: string;
}

export interface Verdict {
  state: SessionState;
  failures: FieldCheck[];
}

/** One model call in a tiered run, with measured latency and cost. */
export interface ModelCall {
  model: "glimmer" | "spark" | "sam";
  /** Which adapter served the call: "stub" or "real". */
  adapter: string;
  outcome: string;
  latencyMs: number;
  /** Estimated USD; exact for stubs ($0 local / fixed estimate), measured for real calls. */
  costUsd: number;
}

export interface AuditEntry {
  ts: string;
  sessionId: string;
  fieldId: string;
  paperValue: string | null;
  typedValue: string | null;
  verdict: SessionState;
  action: string;
  /** Per-call latency/cost for the pipeline run that produced this entry. */
  modelCalls?: ModelCall[];
}

export interface ClaimDraft {
  carrier: string;
  bolRef: string;
  awbRef: string;
  exceptionNote: string;
  damagedQty: number | null;
  /** Claimed amount; a placeholder until the adjuster prices the damage. */
  amount: string;
  /** "template" today; "spark" once the Spark hook drafts the body. */
  source: "template" | "spark";
  body: string;
}
