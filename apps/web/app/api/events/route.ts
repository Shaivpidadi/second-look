import { NextResponse } from "next/server";
import { evaluatePartialSubmission } from "../../../lib/gate";
import { publishLiveVerdict } from "../../../lib/verdict-bus";

export interface FormEvent {
  sessionId: string;
  fieldId: string;
  value: string;
  ts: string;
}

const store = new Map<string, FormEvent[]>();
const valuesBySession = new Map<string, Record<string, string>>();

/**
 * Artificial verdict delay in ms, read at call time. Set VERDICT_DELAY_MS
 * to slow the live verdict (e.g. 2000) and prove the form still renders
 * exactly one block and one fix; default 0.
 */
function verdictDelayMs(): number {
  const raw = process.env.VERDICT_DELAY_MS;
  if (raw === undefined) return 0;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

export async function POST(request: Request) {
  const event = (await request.json()) as Partial<FormEvent>;
  if (
    typeof event.sessionId !== "string" ||
    typeof event.fieldId !== "string" ||
    typeof event.value !== "string" ||
    typeof event.ts !== "string"
  ) {
    return NextResponse.json({ ok: false, error: "bad_event" }, { status: 400 });
  }
  const list = store.get(event.sessionId) ?? [];
  list.push(event as FormEvent);
  store.set(event.sessionId, list);

  const values = valuesBySession.get(event.sessionId) ?? {};
  values[event.fieldId] = event.value;
  valuesBySession.set(event.sessionId, values);

  // Live verdict, computed off the request path so typing stays responsive.
  // A slow computation publishes late with a stale sequence number, which
  // the client's tracker drops.
  const snapshot = { ...values };
  const { sessionId, fieldId } = event;
  const delay = verdictDelayMs();
  void (async () => {
    try {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const result = evaluatePartialSubmission(snapshot);
      publishLiveVerdict(sessionId, {
        fieldId,
        decision: result.decision,
        state: result.verdict.state,
        failures: result.failures,
        ts: new Date().toISOString(),
      });
    } catch (error) {
      console.error("live verdict failed", error);
    }
  })();

  return NextResponse.json({ ok: true, count: list.length });
}
