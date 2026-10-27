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

export interface AuditEntry {
  ts: string;
  sessionId: string;
  fieldId: string;
  paperValue: string | null;
  typedValue: string | null;
  verdict: SessionState;
  action: string;
}

export interface ClaimDraft {
  carrier: string;
  bolRef: string;
  awbRef: string;
  exceptionNote: string;
  damagedQty: number | null;
  body: string;
}
