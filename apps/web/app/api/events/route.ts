import { NextResponse } from "next/server";
import { fieldLabel } from "../../../lib/fields";
import {
  FRAME_FIELD_ID,
  handleFramePost,
  sessionDocTypes,
  sessionPaperValues,
} from "../../../lib/frame-path";
import { signatureFailure, unverifiedField } from "../../../lib/paper-match";
import { evaluatePartialSubmission } from "../../../lib/gate";
import { processMap } from "../../../lib/process-store";
import { publishLiveVerdict } from "../../../lib/verdict-bus";

/**
 * Node runtime (the frame path uses Buffer and node:crypto) with headroom
 * for a max-size frame POST; frame POSTs await their own verdicts
 * (typically a few seconds) so the app works even when SSE lands on
 * another instance. Note the verdict bus is still in-memory, so the SSE
 * stream is best-effort cross-instance; the POST response is the
 * reliable channel and clients dedupe by verdict id.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export interface FormEvent {
  sessionId: string;
  fieldId: string;
  value: string;
  ts: string;
  /** Frame-only: client-sent session memory (extracted fields). */
  memory?: unknown;
}

const store = processMap<string, FormEvent[]>("form-events");
const valuesBySession = processMap<string, Record<string, string>>("form-values");

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
  // Frame events never touch the text store: the image bytes would
  // bloat every snapshot, and frames get vision verdicts, not typing ones.
  if (event.fieldId === FRAME_FIELD_ID) {
    const sessionIdForFrame = event.sessionId;
    const posted = handleFramePost({
      sessionId: event.sessionId,
      value: event.value,
      typedValues: valuesBySession.get(event.sessionId) ?? {},
      latestTypedValues: () => ({ ...(valuesBySession.get(sessionIdForFrame) ?? {}) }),
      memory: event.memory,
    });
    if (posted.outcome === "rejected") {
      return NextResponse.json({ ok: false, error: posted.error }, { status: 400 });
    }
    if (posted.outcome === "undecodable") {
      return NextResponse.json({ ok: false, error: "bad_frame_image" }, { status: 422 });
    }
    if (posted.outcome === "duplicate") {
      return NextResponse.json({ ok: true, frame: "duplicate", reason: posted.reason, verdicts: [] });
    }
    if (posted.outcome === "throttled") {
      return NextResponse.json({ ok: true, frame: "throttled", verdicts: [posted.verdict] });
    }
    // The POST awaits its own verdicts so the app works when SSE lands
    // on another instance; typically a few seconds, capped at 60s above.
    const completed = await posted.done;
    if (completed === null) {
      return NextResponse.json({ ok: false, error: "frame_judge_failed" }, { status: 502 });
    }
    const verdicts = [completed.frameVerdict];
    if (completed.crossDocVerdict) verdicts.push(completed.crossDocVerdict);
    if (completed.paperVerdict) verdicts.push(completed.paperVerdict);
    return NextResponse.json({
      ok: true,
      frame: "judged",
      verdicts,
      document: completed.result.document ?? null,
      readings: completed.result.readings ?? {},
      memoryAccepted: completed.memoryAccepted,
    });
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
      // Paper read earlier by the glasses is checked against what was
      // just typed, so docs-first sessions catch mismatches too.
      const paper = sessionPaperValues(sessionId);
      const result = evaluatePartialSubmission(snapshot, paper);
      const unverified = unverifiedField(
        fieldId,
        snapshot[fieldId] ?? "",
        paper,
        sessionDocTypes(sessionId),
        fieldLabel(fieldId),
      );
      // An unreadable receiver signature stays visible while typing; a
      // blank one already blocks through the gate.
      const signature = signatureFailure(paper, sessionDocTypes(sessionId));
      const abstains = [unverified, signature?.rule === "unreadable" ? signature : null].filter(
        (f) => f !== null,
      );
      const failures = [...result.failures, ...abstains];
      const state =
        abstains.length > 0 && result.decision === "ALLOW" ? "needs-human" : result.verdict.state;
      publishLiveVerdict(sessionId, {
        fieldId,
        decision: result.decision,
        state,
        failures,
        ts: new Date().toISOString(),
      });
    } catch (error) {
      console.error("live verdict failed", error);
    }
  })();

  return NextResponse.json({ ok: true, count: list.length });
}
