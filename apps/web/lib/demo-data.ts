/**
 * Demo dataset for the dashboard. This is fixture data, generated
 * deterministically from a fixed seed, and is never real usage.
 * Latency and cost shapes follow the measured eval numbers in the
 * README table and STATUS.md (escalated verdicts around 2 to 4s,
 * text Spark calls a few tenths of a cent, vision calls ~$0.015).
 */

export interface DemoModelCall {
  model: string;
  adapter: string;
  outcome: string;
  latencyMs: number;
  costUsd: number;
}

export interface DemoAuditEntry {
  ts: string;
  sessionId: string;
  fieldId: string;
  paperValue: string | null;
  typedValue: string | null;
  verdict: string;
  action: string;
  modelCalls?: DemoModelCall[];
}

export interface DemoClaim {
  carrier: string;
  bolRef: string;
  awbRef: string;
  exceptionNote: string;
  damagedQty: number | null;
  amount: string;
  source: string;
  body: string;
}

/** Deterministic PRNG so the dataset is stable across renders. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AWBS = [
  "02027342210", "87915419121", "17600428133", "40611298302",
  "05799124518", "77340128654", "11298047563", "90123774551",
];
const BOLS = [
  "BOL-00421307", "BOL-36537779", "BOL-66554908",
  "BOL-90124417", "BOL-12883390", "BOL-77412056",
];
const CONTAINERS = [
  "CSQU3054383", "TCLU7620763", "MSKU4812095", "HLXU3341872", "TEMU9081234",
];
const SSCCS = [
  "106141410000001238", "106141410000004412", "106141410000007739",
];
const NOTES = [
  "2 cartons damaged",
  "1 pallet crushed on arrival",
  "shrink wrap torn, 3 cartons wet",
  "tailgate dent, 1 carton short",
];

function glimmer(outcome: "agree" | "disagree", latencyMs: number): DemoModelCall {
  return { model: "glimmer", adapter: "local", outcome, latencyMs, costUsd: 0 };
}

function spark(latencyMs: number, costUsd: number, cached = false): DemoModelCall {
  return {
    model: "spark",
    adapter: "muse-spark-1.3",
    outcome: cached ? "escalation (cached)" : "escalation",
    latencyMs,
    costUsd,
  };
}

interface RunSpec {
  verdict: "clean" | "mismatch" | "blocked" | "needs-human";
  fieldId: string;
  paperValue: string | null;
  typedValue: string;
  action: string;
  calls: DemoModelCall[];
  /** Optional second entry sharing the run timestamp. */
  extra?: { fieldId: string; paperValue: string | null; typedValue: string; action: string };
}

export function buildDemoDataset(baseTs: number): { entries: DemoAuditEntry[]; claims: DemoClaim[] } {
  const rand = mulberry32(20261028);
  const pick = <T>(pool: T[]): T => pool[Math.floor(rand() * pool.length)] as T;
  const range = (lo: number, hi: number): number => Math.round(lo + rand() * (hi - lo));

  const specs: RunSpec[] = [];
  const pushClean = (fieldId: string, value: string, fast: boolean): void => {
    specs.push({
      verdict: "clean",
      fieldId,
      paperValue: fast ? null : value,
      typedValue: value,
      action: "submit_allow",
      calls: fast
        ? []
        : [glimmer("disagree", range(180, 320)), spark(range(1900, 2800), 0.0021 + rand() * 0.002)],
    });
  };

  // 18 clean: fast validators or local pass, plus spark-confirmed reviews.
  const cleanFields: Array<[string, () => string]> = [
    ["awb.awbNumber", () => pick(AWBS)],
    ["bol.bolNumber", () => pick(BOLS)],
    ["bol.containerNumber", () => pick(CONTAINERS)],
    ["label.sscc", () => pick(SSCCS)],
    ["pod.receivedCartons", () => String(range(40, 200))],
  ];
  for (let i = 0; i < 18; i++) {
    const [fieldId, make] = cleanFields[i % cleanFields.length] as [string, () => string];
    pushClean(fieldId, make(), i < 8 && i % 2 === 0);
  }

  // 10 cross-doc mismatches: invoice vs packing pairs.
  for (let i = 0; i < 10; i++) {
    const invoiceQty = range(100, 400);
    const packingQty = invoiceQty + (rand() > 0.5 ? 1 : -1) * range(1, 3);
    specs.push({
      verdict: "mismatch",
      fieldId: "invoice.totalQty",
      paperValue: String(invoiceQty),
      typedValue: String(invoiceQty),
      action: "flag:cross_doc",
      calls: [glimmer("disagree", range(180, 320)), spark(range(2400, 3400), 0.0024 + rand() * 0.002)],
      extra: {
        fieldId: "packing.totalQty",
        paperValue: String(packingQty),
        typedValue: String(packingQty),
        action: "flag:cross_doc",
      },
    });
  }

  // 7 blocks: bad check digits and short counts.
  const blockSpecs: Array<() => Omit<RunSpec, "verdict" | "calls">> = [
    () => ({
      fieldId: "awb.awbNumber", paperValue: "02027342210", typedValue: "02027342201",
      action: "submit_block:awb_check_digit",
    }),
    () => ({
      fieldId: "bol.containerNumber", paperValue: "CSQU3054383", typedValue: "CSQU3054388",
      action: "submit_block:container_check_digit",
    }),
    () => ({
      fieldId: "pod.receivedCartons", paperValue: "120", typedValue: "118",
      action: "submit_block:count_mismatch",
    }),
  ];
  for (let i = 0; i < 7; i++) {
    const spec = (blockSpecs[i % blockSpecs.length] as () => Omit<RunSpec, "verdict" | "calls">)();
    specs.push({
      verdict: "blocked",
      ...spec,
      calls: [glimmer("disagree", range(180, 320)), spark(range(2600, 3900), 0.003 + rand() * 0.0028)],
    });
  }

  // 5 needs-human: unreadable handwriting or glare.
  for (let i = 0; i < 5; i++) {
    const handwriting = i % 2 === 0;
    specs.push({
      verdict: "needs-human",
      fieldId: handwriting ? "pod.exceptionNote" : "label.sscc",
      paperValue: null,
      typedValue: handwriting ? pick(NOTES) : pick(SSCCS),
      action: "needs_human:unreadable",
      calls: [glimmer("disagree", range(200, 340)), spark(range(2900, 4300), 0.012 + rand() * 0.006)],
    });
  }

  // Shuffle so verdicts interleave over time instead of banding.
  for (let i = specs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = specs[i] as RunSpec;
    specs[i] = specs[j] as RunSpec;
    specs[j] = a;
  }
  // Guarantee the first screenful shows every non-clean status: swap
  // a missing verdict in from later, keeping timestamps positional
  // so the table stays honestly newest-first.
  const FIRST_SCREEN = 8;
  for (const verdict of ["blocked", "mismatch", "needs-human"] as const) {
    const covered = specs.slice(0, FIRST_SCREEN).some((spec) => spec.verdict === verdict);
    if (covered) continue;
    const donor = specs.findIndex(
      (spec, i) => i >= FIRST_SCREEN && spec.verdict === verdict,
    );
    const recipient = specs.findIndex(
      (spec, i) => i < FIRST_SCREEN && spec.verdict === "clean",
    );
    if (donor !== -1 && recipient !== -1) {
      const a = specs[donor] as RunSpec;
      specs[donor] = specs[recipient] as RunSpec;
      specs[recipient] = a;
    }
  }
  // Spread runs over the last 8 hours, newest first, with seconds
  // randomized so timestamps do not share one clock reading.
  const entries: DemoAuditEntry[] = [];
  specs.forEach((spec, i) => {
    const offsetSec = 180 + i * 720 + Math.floor(rand() * 600);
    const ts = new Date(baseTs - offsetSec * 1000).toISOString();
    const calls = spec.calls.length > 0 ? spec.calls : undefined;
    entries.push({
      ts,
      sessionId: "demo",
      fieldId: spec.fieldId,
      paperValue: spec.paperValue,
      typedValue: spec.typedValue,
      verdict: spec.verdict,
      action: spec.action,
      modelCalls: calls,
    });
    if (spec.extra) {
      entries.push({
        ts,
        sessionId: "demo",
        fieldId: spec.extra.fieldId,
        paperValue: spec.extra.paperValue,
        typedValue: spec.extra.typedValue,
        verdict: spec.verdict,
        action: spec.extra.action,
      });
    }
  });

  const claims: DemoClaim[] = [
    {
      carrier: "Harbour Line Goods",
      bolRef: "BOL-36537779",
      awbRef: "87915419121",
      exceptionNote: "2 cartons damaged",
      damagedQty: 2,
      amount: "[AMOUNT TBD]",
      source: "template",
      body: [
        "Damage claim for Harbour Line Goods",
        "BOL BOL-36537779 / AWB 87915419121",
        'POD exception: "2 cartons damaged"',
        "Damaged quantity: 2 cartons",
        "Claimed amount: [AMOUNT TBD]",
        "",
        "Adjuster: confirm the count against the POD photos, price the goods,",
        "and replace the amount placeholder before filing.",
      ].join("\n"),
    },
    {
      carrier: "Blue Anchor Supply",
      bolRef: "BOL-77412056",
      awbRef: "40611298302",
      exceptionNote: "1 pallet crushed on arrival",
      damagedQty: 1,
      amount: "[AMOUNT TBD]",
      source: "template",
      body: [
        "Damage claim for Blue Anchor Supply",
        "BOL BOL-77412056 / AWB 40611298302",
        'POD exception: "1 pallet crushed on arrival"',
        "Damaged quantity: 1 carton",
        "Claimed amount: [AMOUNT TBD]",
        "",
        "Adjuster: confirm the count against the POD photos, price the goods,",
        "and replace the amount placeholder before filing.",
      ].join("\n"),
    },
  ];

  return { entries, claims };
}
