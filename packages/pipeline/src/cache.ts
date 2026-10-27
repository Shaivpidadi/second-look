import { createHash } from "node:crypto";
import type { SparkEscalationOutput } from "./spark.ts";
import type { Crop, FieldReading } from "./types.ts";

/** Stable hash of a readings list for verdict-cache keys. */
export function hashReadings(readings: FieldReading[]): string {
  const stable = [...readings]
    .map((r) => [r.fieldId, r.paperValue, r.typedValue] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/**
 * Fields whose paper or typed value changed between two readings lists
 * (added, removed, or edited). Empty when the lists agree field by field.
 */
export function changedReadings(
  previous: FieldReading[],
  next: FieldReading[],
): FieldReading[] {
  const prevByField = new Map(previous.map((r) => [r.fieldId, r]));
  const changed: FieldReading[] = [];
  for (const reading of next) {
    const prev = prevByField.get(reading.fieldId);
    prevByField.delete(reading.fieldId);
    if (
      !prev ||
      prev.paperValue !== reading.paperValue ||
      prev.typedValue !== reading.typedValue
    ) {
      changed.push({ ...reading });
    }
  }
  for (const removed of prevByField.values()) {
    changed.push({ fieldId: removed.fieldId, paperValue: null, typedValue: null });
  }
  return changed;
}

interface VerdictEntry {
  reasons: string[];
  readings: FieldReading[];
  spark: SparkEscalationOutput;
}

export type VerdictLookup =
  | { hit: true; spark: SparkEscalationOutput }
  | { hit: false; send: FieldReading[] };

/**
 * Per-run Spark escalation cache. A repeat escalation over identical
 * readings and reasons reuses the stored output with zero marginal cost
 * and latency; a repeat with edits sends only the changed fields when the
 * only reason is a local-pass disagreement (cross-doc and handwriting
 * escalations keep full context).
 */
export class VerdictCache {
  private readonly entries = new Map<string, VerdictEntry>();
  private lastKey: string | null = null;
  private readonly maxEntries: number;
  hits = 0;

  constructor(maxEntries = 64) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  lookup(readings: FieldReading[], reasons: string[]): VerdictLookup {
    const key = hashReadings(readings);
    const entry = this.entries.get(key);
    if (entry && sameReasons(entry.reasons, reasons)) {
      this.hits += 1;
      return {
        hit: true,
        spark: { ...entry.spark, latencyMs: 0, costUsd: 0 },
      };
    }
    const last = this.lastKey === null ? undefined : this.entries.get(this.lastKey);
    if (
      last &&
      reasons.length === 1 &&
      reasons[0] === "glimmer_disagree" &&
      sameReasons(last.reasons, reasons)
    ) {
      const changed = changedReadings(last.readings, readings);
      if (changed.length > 0) return { hit: false, send: changed };
    }
    return { hit: false, send: readings.map((r) => ({ ...r })) };
  }

  store(readings: FieldReading[], reasons: string[], spark: SparkEscalationOutput): void {
    const key = hashReadings(readings);
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, {
      reasons: [...reasons],
      readings: readings.map((r) => ({ ...r })),
      spark: { ...spark },
    });
    this.lastKey = key;
  }
}

function sameReasons(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((reason, i) => reason === b[i]);
}

/**
 * Per-run crop cache keyed by frame hash: identical frames reuse crops
 * without another segmentation call.
 */
export class CropCache {
  private readonly entries = new Map<string, Crop[]>();
  private readonly maxEntries: number;
  hits = 0;

  constructor(maxEntries = 128) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  get(hash: string): Crop[] | null {
    const crops = this.entries.get(hash);
    if (!crops) return null;
    this.hits += 1;
    return crops.map((crop) => ({ box: { ...crop.box }, image: crop.image }));
  }

  set(hash: string, crops: Crop[]): void {
    if (!this.entries.has(hash) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(
      hash,
      crops.map((crop) => ({ box: { ...crop.box }, image: crop.image })),
    );
  }
}
