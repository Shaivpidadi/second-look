/**
 * Fake-video E2E scenario matrix. One shipment ground truth, paper docs
 * with planted errors, and the typed receiving form. Every paired case
 * runs twice: form-first (typed values exist when the paper is seen)
 * and docs-first (paper seen first, then the worker types). All values
 * are synthetic; check-digit alternates were computed with
 * @second-look/validators so they pass validators (validator-blind).
 */

export const PAPER = {
  bol: {
    bolNumber: "BOL-00421307",
    carrier: "HARBOUR LINE GOODS",
    consignee: "BLUE RIVER DISTRIBUTION",
    containerNumber: "CSQU3054383",
    cartons: "120",
    weightKg: "2064",
  },
  awb: { awbNumber: "02027342210", consignee: "BLUE RIVER DISTRIBUTION", pieces: "120", weightKg: "2064" },
  invoice: { totalQty: "360" },
  packing: { totalQty: "360", cartons: "120", weightKg: "2064" },
  pod: { bolNumber: "BOL-00421307", shipped: "120", receivedCartons: "120", exceptionNote: "", signed: true },
  label: { sscc: "106141410000001238" },
};

/** The /form fields, typed exactly as the paper says. */
export const TYPED = {
  "awb.awbNumber": "02027342210",
  "bol.bolNumber": "BOL-00421307",
  "bol.carrier": "HARBOUR LINE GOODS",
  "bol.consignee": "BLUE RIVER DISTRIBUTION",
  "bol.containerNumber": "CSQU3054383",
  "label.sscc": "106141410000001238",
  "bol.cartons": "120",
  "pod.receivedCartons": "120",
  "pod.exceptionNote": "",
};

const ALL_DOCS = ["bol", "awb", "invoice", "packing", "pod", "label"];

/**
 * Base cases. `docs` are clips in viewing order: a type name or
 * { type, fields, degrade }. `typed` overrides TYPED. `expect.flags`
 * lists field ids that must be flagged by some live channel; an empty
 * list means the session must stay clean. `blockOnSubmit` says the
 * final POST /api/submit must BLOCK. `directions` defaults to both.
 */
export const CASES = [
  {
    id: "clean-bol",
    title: "Clean BOL vs correct form",
    docs: ["bol"],
    expect: { flags: [], blockOnSubmit: false },
  },
  {
    id: "bol-cartons",
    title: "Wrong carton count typed (102 vs paper 120)",
    docs: ["bol"],
    typed: { "bol.cartons": "102", "pod.receivedCartons": "102" },
    expect: { flags: ["bol.cartons"], blockOnSubmit: true },
  },
  {
    id: "bol-number",
    title: "Wrong BOL/PRO number typed (transposed digits)",
    docs: ["bol"],
    typed: { "bol.bolNumber": "BOL-00421370" },
    expect: { flags: ["bol.bolNumber"], blockOnSubmit: true },
  },
  {
    id: "bol-carrier",
    title: "Wrong party name typed (carrier)",
    docs: ["bol"],
    typed: { "bol.carrier": "HARBOUR LINE CARGO" },
    expect: { flags: ["bol.carrier"], blockOnSubmit: true },
  },
  {
    id: "consignee-wrong",
    title: "Wrong consignee typed (a different party, one word off)",
    docs: ["bol"],
    typed: { "bol.consignee": "BLUE RIDGE DISTRIBUTION" },
    expect: { flags: ["bol.consignee"], blockOnSubmit: true },
  },
  {
    id: "consignee-format",
    title: "Consignee formatting differs (case, comma, Inc., Dist.): must not flag",
    docs: [{ type: "bol", fields: { consignee: "Blue River Distribution, Inc." } }],
    typed: { "bol.consignee": "BLUE RIVER DIST. INC" },
    expect: { flags: [], blockOnSubmit: false },
  },
  {
    id: "xdoc-consignee",
    title: "BOL consignee vs AWB consignee name a different party (paper vs paper)",
    docs: ["bol", { type: "awb", fields: { consignee: "BLUE RIDGE DISTRIBUTION" } }],
    orders: [["bol", "awb"], ["awb", "bol"]],
    expect: { flags: ["awb.consignee"], blockOnSubmit: false },
  },
  {
    id: "container-blind",
    title: "Wrong container typed, valid check digit (validator-blind)",
    docs: ["bol"],
    typed: { "bol.containerNumber": "CSQU3054830" },
    expect: { flags: ["bol.containerNumber"], blockOnSubmit: true },
  },
  {
    id: "awb-blind",
    title: "Wrong AWB typed, valid check digit (validator-blind)",
    docs: ["awb"],
    typed: { "awb.awbNumber": "02027342280" },
    expect: { flags: ["awb.awbNumber"], blockOnSubmit: true },
  },
  {
    id: "awb-swap",
    title: "Swapped AWB digits (check digit fails)",
    docs: ["awb"],
    typed: { "awb.awbNumber": "02027432210" },
    expect: { flags: ["awb.awbNumber"], blockOnSubmit: true },
  },
  {
    id: "sscc-blind",
    title: "Wrong SSCC typed, valid GS1 check digit",
    docs: ["label"],
    typed: { "label.sscc": "106141410000001320" },
    expect: { flags: ["label.sscc"], blockOnSubmit: true },
  },
  {
    id: "pod-short",
    title: "POD short 2 with damage note, BOL + POD",
    docs: ["bol", { type: "pod", fields: { receivedCartons: "118", exceptionNote: "2 cartons damaged" } }],
    typed: { "pod.receivedCartons": "118", "pod.exceptionNote": "2 cartons damaged" },
    expect: { flags: ["pod.receivedCartons"], blockOnSubmit: true, claim: true },
  },
  {
    id: "pod-typed-wrong",
    title: "POD says 118 received, typed 120",
    docs: [{ type: "pod", fields: { receivedCartons: "118", exceptionNote: "2 cartons damaged" } }],
    typed: { "pod.receivedCartons": "120" },
    expect: { flags: ["pod.receivedCartons"], blockOnSubmit: true },
  },
  {
    id: "pod-unsigned",
    title: "Delivery receipt with a blank receiver signature line",
    docs: [{ type: "pod", fields: { signed: false } }],
    expect: { flags: ["pod.receiverSigned"], blockOnSubmit: true },
  },
  {
    id: "pod-signed",
    title: "Signed delivery receipt, correct form: must not flag",
    docs: ["pod"],
    expect: { flags: [], blockOnSubmit: false },
  },
  {
    id: "pod-sign-covered",
    title: "Signature line covered by a sticky note: flag or abstain, never silent",
    docs: [{ type: "pod", fields: { signatureCover: true } }],
    expect: { flags: ["pod.receiverSigned"], blockOnSubmit: null, allowAbstain: true },
  },
  {
    id: "xdoc-weight",
    title: "BOL 2064 kg vs AWB 2046 kg (paper vs paper)",
    docs: ["bol", { type: "awb", fields: { weightKg: "2046" } }],
    orders: [["bol", "awb"], ["awb", "bol"]],
    expect: { flags: ["awb.weightKg"], blockOnSubmit: false },
  },
  {
    id: "xdoc-qty",
    title: "Invoice 363 vs packing list 365 (paper vs paper)",
    docs: [
      { type: "invoice", fields: { totalQty: "363", lines: [["BRK-200", "Front brake assembly", 120, "38.00"], ["BRK-210", "Rear brake assembly", 123, "34.50"], ["PAD-090", "Pad set", 120, "9.75"]] } },
      { type: "packing", fields: { totalQty: "365", lines: [["BRK-200", "40 CTNS", 120], ["BRK-210", "41 CTNS", 125], ["PAD-090", "40 CTNS", 120]] } },
    ],
    orders: [["invoice", "packing"], ["packing", "invoice"]],
    expect: { flags: ["invoice.totalQty"], blockOnSubmit: false },
  },
  {
    id: "clean-full",
    title: "Full clean session: six documents, correct form",
    docs: ALL_DOCS,
    expect: { flags: [], blockOnSubmit: false },
  },
  {
    id: "clean-full-shuffled",
    title: "Full clean session, documents in reverse order",
    docs: [...ALL_DOCS].reverse(),
    expect: { flags: [], blockOnSubmit: false },
  },
  {
    id: "screen-glance",
    title: "Glasses glance at the form screen between papers",
    docs: [{ type: "screen" }, "bol"],
    directions: ["form-first"],
    expect: { flags: [], blockOnSubmit: false },
  },
  {
    id: "degraded-cartons",
    title: "Heavy blur and glare, wrong cartons typed: flag or abstain, never silent",
    docs: [{ type: "bol", degrade: "heavy" }],
    typed: { "bol.cartons": "102", "pod.receivedCartons": "102" },
    expect: { flags: ["bol.cartons"], blockOnSubmit: null, allowAbstain: true },
  },
  {
    id: "cutoff-container",
    title: "Worker leans in, container number clipped by the frame edge: flag or abstain",
    docs: [{ type: "bol", framing: "tight" }],
    typed: { "bol.containerNumber": "CSQU3054830" },
    expect: { flags: ["bol.containerNumber"], blockOnSubmit: null, allowAbstain: true },
  },
];

function docSpec(entry) {
  return typeof entry === "string" ? { type: entry } : entry;
}

/** Expand cases into runnable scenarios (one per direction/order). */
export function expandScenarios() {
  const out = [];
  for (const c of CASES) {
    const docs = c.docs.map(docSpec);
    const typed = { ...TYPED, ...(c.typed ?? {}) };
    if (c.orders) {
      for (const order of c.orders) {
        const ordered = order.map((t) => docs.find((d) => d.type === t));
        out.push({ ...c, id: `${c.id}:${order.join(">")}`, caseId: c.id, direction: "form-first", order: order.join(" > "), docs: ordered, typed });
      }
      continue;
    }
    for (const direction of c.directions ?? ["form-first", "docs-first"]) {
      out.push({ ...c, id: `${c.id}:${direction}`, caseId: c.id, direction, order: docs.map((d) => d.type).join(" > "), docs, typed });
    }
  }
  return out;
}

/** Paper fields for one clip: ground truth plus per-case overrides. */
export function paperFields(doc, typed) {
  if (doc.type === "screen") return { ...typed };
  return { ...(PAPER[doc.type] ?? {}), ...(doc.fields ?? {}) };
}
