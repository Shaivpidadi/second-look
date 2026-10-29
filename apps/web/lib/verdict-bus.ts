import { randomBytes } from "node:crypto";
import type { LiveVerdictFailure } from "./live-verdict.ts";
import { processMap } from "./process-store.ts";

export interface PublishedVerdict {
  /**
   * Unique id per published verdict. POST responses and SSE carry the
   * same objects, so clients dedupe on this when both channels deliver.
   */
  id: string;
  seq: number;
  sessionId: string;
  fieldId: string;
  decision: "ALLOW" | "BLOCK";
  state: string;
  failures: LiveVerdictFailure[];
  ts: string;
}

export type VerdictListener = (verdict: PublishedVerdict) => void;

interface SessionBus {
  seq: number;
  listeners: Set<VerdictListener>;
}

const sessions = processMap<string, SessionBus>("verdict-bus");

function busFor(sessionId: string): SessionBus {
  let bus = sessions.get(sessionId);
  if (!bus) {
    bus = { seq: 0, listeners: new Set() };
    sessions.set(sessionId, bus);
  }
  return bus;
}

/**
 * Publish a verdict to a session's SSE subscribers, assigning the next
 * session sequence number. Returns the full published verdict.
 */
export function publishLiveVerdict(
  sessionId: string,
  verdict: Omit<PublishedVerdict, "id" | "seq" | "sessionId">,
): PublishedVerdict {
  const bus = busFor(sessionId);
  bus.seq += 1;
  const published: PublishedVerdict = {
    ...verdict,
    id: randomBytes(6).toString("hex"),
    seq: bus.seq,
    sessionId,
  };
  for (const listener of bus.listeners) listener(published);
  return published;
}

/** Subscribe to a session's verdicts; the returned function unsubscribes. */
export function subscribeLiveVerdicts(
  sessionId: string,
  listener: VerdictListener,
): () => void {
  const bus = busFor(sessionId);
  bus.listeners.add(listener);
  return () => {
    bus.listeners.delete(listener);
  };
}

/** Highest sequence published for a session; 0 when it has none. */
export function currentSeq(sessionId: string): number {
  return sessions.get(sessionId)?.seq ?? 0;
}

/** Test-only reset for the in-memory bus. */
export function __resetLiveVerdictBus(): void {
  sessions.clear();
}
