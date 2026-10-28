/** Fixture replay data for the /demo record screen. Deterministic and offline. */

export interface FixtureField {
  id: string;
  label: string;
  paper: string;
  typed: string;
  state: "ok" | "bad";
}

export interface FixtureCard {
  from: string;
  title: string;
  body: string;
  tone: "pass" | "warn" | "block" | "info";
  model: string;
  latencyMs: number;
  costUsd: number;
}

export interface FixtureAudit {
  moment: string;
  field: string;
  action: string;
  verdict: "clean" | "mismatch" | "blocked";
}

export interface DemoStep {
  id: string;
  kicker: string;
  title: string;
  hint: string;
  doc: "awb" | "invoice" | "pod" | "clean";
  fields: FixtureField[];
  cards: FixtureCard[];
  audit: FixtureAudit[];
  verdict: "blocked" | "mismatch" | "clean";
  fix?: { fieldId: string; value: string };
  claim?: { carrier: string; bolRef: string; damagedQty: number };
}

export const DEMO_STEPS: DemoStep[] = [
  {
    id: "awb-typo",
    kicker: "Moment 1 of 4",
    title: "AWB check-digit typo",
    hint: "Two digits swapped in the typed AWB number.",
    doc: "awb",
    verdict: "blocked",
    fix: { fieldId: "awb.awbNumber", value: "87915419121" },
    fields: [
      { id: "awb.awbNumber", label: "AWB number", paper: "87915419121", typed: "87915411921", state: "bad" },
      { id: "bol.bolNumber", label: "BOL number", paper: "BOL-36537779", typed: "BOL-36537779", state: "ok" },
      { id: "bol.containerNumber", label: "Container", paper: "CSQU3054383", typed: "CSQU3054383", state: "ok" },
      { id: "label.sscc", label: "SSCC", paper: "106141410000001238", typed: "106141410000001238", state: "ok" },
    ],
    cards: [
      {
        from: "validators",
        title: "Check digit failed",
        body: "AWB number: serial mod-7 mismatch. Instant block, no model call.",
        tone: "block",
        model: "validators",
        latencyMs: 0.4,
        costUsd: 0,
      },
      {
        from: "glimmer",
        title: "Local pass disagrees",
        body: "Crop read does not match the typed value. Escalating with redacted payload.",
        tone: "warn",
        model: "glimmer · local",
        latencyMs: 212,
        costUsd: 0,
      },
      {
        from: "spark",
        title: "Fix proposed",
        body: "Paper holds 87915419121, one transposition away. Submit stays blocked until applied.",
        tone: "info",
        model: "spark · muse-spark-1.3",
        latencyMs: 2840,
        costUsd: 0.0021,
      },
    ],
    audit: [
      { moment: "Moment 1", field: "awb.awbNumber", action: "submit_block:check_digit", verdict: "blocked" },
      { moment: "Moment 1", field: "awb.awbNumber", action: "fix_proposed", verdict: "blocked" },
    ],
  },
  {
    id: "qty-gap",
    kicker: "Moment 2 of 4",
    title: "Invoice vs packing list",
    hint: "Paper matches typed, but the documents disagree with each other.",
    doc: "invoice",
    verdict: "mismatch",
    fields: [
      { id: "invoice.totalQty", label: "Invoice qty", paper: "363", typed: "363", state: "ok" },
      { id: "packing.totalQty", label: "Packing qty", paper: "365", typed: "365", state: "ok" },
      { id: "bol.weightKg", label: "BOL weight kg", paper: "4200", typed: "4200", state: "ok" },
      { id: "awb.weightKg", label: "AWB weight kg", paper: "4200", typed: "4200", state: "ok" },
    ],
    cards: [
      {
        from: "validators",
        title: "Cross-doc conflict",
        body: "Invoice 363 vs packing 365. Warned for review.",
        tone: "warn",
        model: "validators",
        latencyMs: 0.6,
        costUsd: 0,
      },
      {
        from: "spark",
        title: "Escalation note",
        body: "No typo here. The source documents disagree, so hold the receipt.",
        tone: "info",
        model: "spark · muse-spark-1.3",
        latencyMs: 3210,
        costUsd: 0.0024,
      },
    ],
    audit: [
      { moment: "Moment 2", field: "invoice.totalQty", action: "flag:cross_doc", verdict: "mismatch" },
      { moment: "Moment 2", field: "invoice.totalQty", action: "escalation", verdict: "mismatch" },
    ],
  },
  {
    id: "pod-claim",
    kicker: "Moment 3 of 4",
    title: "Handwritten POD note",
    hint: "“2 cartons damaged” in handwriting becomes a claim draft.",
    doc: "pod",
    verdict: "mismatch",
    claim: { carrier: "Harbour Line Goods", bolRef: "BOL-36537779", damagedQty: 2 },
    fields: [
      { id: "bol.cartons", label: "Shipped cartons", paper: "120", typed: "120", state: "ok" },
      { id: "pod.receivedCartons", label: "Received cartons", paper: "118", typed: "118", state: "ok" },
      { id: "pod.exceptionNote", label: "Exception note", paper: "2 cartons damaged", typed: "2 cartons damaged", state: "ok" },
    ],
    cards: [
      {
        from: "glimmer",
        title: "Handwriting detected",
        body: "POD exception note present. Free text redacted before any cloud call.",
        tone: "warn",
        model: "glimmer · local",
        latencyMs: 188,
        costUsd: 0,
      },
      {
        from: "claim",
        title: "Claim drafted",
        body: "Harbour Line Goods BOL-36537779 · 2 damaged · amount [AMOUNT TBD].",
        tone: "info",
        model: "template",
        latencyMs: 3,
        costUsd: 0,
      },
    ],
    audit: [
      { moment: "Moment 3", field: "pod.exceptionNote", action: "flag:handwriting", verdict: "mismatch" },
      { moment: "Moment 3", field: "pod.exceptionNote", action: "claim_draft", verdict: "mismatch" },
    ],
  },
  {
    id: "clean-submit",
    kicker: "Moment 4 of 4",
    title: "Clean submit",
    hint: "Everything agrees. Receipt accepted, nothing escalated.",
    doc: "clean",
    verdict: "clean",
    fields: [
      { id: "awb.awbNumber", label: "AWB number", paper: "87915419121", typed: "87915419121", state: "ok" },
      { id: "bol.containerNumber", label: "Container", paper: "CSQU3054383", typed: "CSQU3054383", state: "ok" },
      { id: "label.sscc", label: "SSCC", paper: "106141410000001238", typed: "106141410000001238", state: "ok" },
      { id: "pod.receivedCartons", label: "Received cartons", paper: "120", typed: "120", state: "ok" },
    ],
    cards: [
      {
        from: "validators",
        title: "All checks passed",
        body: "Check digits valid, cross-doc pairs agree, no handwriting.",
        tone: "pass",
        model: "validators",
        latencyMs: 0.5,
        costUsd: 0,
      },
      {
        from: "glimmer",
        title: "Local pass agrees",
        body: "Crops match typed values. No Spark call, so $0 this receipt.",
        tone: "pass",
        model: "glimmer · local",
        latencyMs: 176,
        costUsd: 0,
      },
    ],
    audit: [
      { moment: "Moment 4", field: "*", action: "submit_allow", verdict: "clean" },
    ],
  },
];
