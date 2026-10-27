/**
 * Client-side live-verdict tracker (DOM-free so node:test can run it).
 * Guards the render path with session sequence numbers and per-field
 * debounce: stale verdicts from a slow computation are dropped, and rapid
 * per-field updates coalesce into a single render.
 */
export interface LiveVerdictFailure {
  fieldId: string;
  rule: string;
  message: string;
  fix?: string;
}

export interface LiveVerdictMessage {
  seq: number;
  fieldId: string;
  decision: "ALLOW" | "BLOCK";
  state?: string;
  failures: LiveVerdictFailure[];
}

export interface LiveVerdictTrackerOptions {
  debounceMs: number;
  onVerdict: (verdict: LiveVerdictMessage) => void;
}

export class LiveVerdictTracker {
  private lastSeq = 0;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly latest = new Map<string, LiveVerdictMessage>();
  private readonly options: LiveVerdictTrackerOptions;

  constructor(options: LiveVerdictTrackerOptions) {
    this.options = options;
  }

  /**
   * Accept one verdict pushed by the server. Messages at or below the
   * highest sequence seen so far are stale (an artificial delay let newer
   * typing overtake them) and are dropped; the newest message per field
   * renders once its debounce window passes with no successor.
   */
  handle(message: LiveVerdictMessage): void {
    if (message.seq <= this.lastSeq) return;
    this.lastSeq = message.seq;
    this.latest.set(message.fieldId, message);
    const pending = this.timers.get(message.fieldId);
    if (pending !== undefined) clearTimeout(pending);
    this.timers.set(
      message.fieldId,
      setTimeout(() => {
        this.timers.delete(message.fieldId);
        const verdict = this.latest.get(message.fieldId);
        if (verdict !== undefined) this.options.onVerdict(verdict);
      }, this.options.debounceMs),
    );
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.latest.clear();
  }
}
