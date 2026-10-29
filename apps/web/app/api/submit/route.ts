import { NextResponse } from "next/server";
import { logAuditEntry } from "../../../lib/audit-store";
import { storeClaimDraft } from "../../../lib/claim-store";
import { sessionPaperValues } from "../../../lib/frame-path";
import { evaluateTieredSubmission } from "../../../lib/gate";

interface SubmitBody {
  sessionId?: string;
  values?: Record<string, string>;
}

export async function POST(request: Request) {
  const body = (await request.json()) as SubmitBody;
  if (typeof body.sessionId !== "string" || typeof body.values !== "object" || body.values === null) {
    return NextResponse.json({ ok: false, error: "bad_submit" }, { status: 400 });
  }
  const paper = sessionPaperValues(body.sessionId);
  const result = await evaluateTieredSubmission(body.values, paper);
  const ts = new Date().toISOString();
  try {
    if (result.failures.length === 0) {
      await logAuditEntry({
        ts,
        sessionId: body.sessionId,
        fieldId: "*",
        paperValue: null,
        typedValue: null,
        verdict: result.verdict.state,
        action: "submit_allow",
        modelCalls: result.modelCalls,
      });
    } else {
      for (const failure of result.failures) {
        await logAuditEntry({
          ts,
          sessionId: body.sessionId,
          fieldId: failure.fieldId,
          paperValue: paper[failure.fieldId] ?? null,
          typedValue: body.values[failure.fieldId] ?? null,
          verdict: result.verdict.state,
          action: `submit_block:${failure.rule}`,
          modelCalls: result.modelCalls,
        });
      }
    }
    if (result.claim) {
      storeClaimDraft(body.sessionId, result.claim);
      await logAuditEntry({
        ts,
        sessionId: body.sessionId,
        fieldId: "pod.exceptionNote",
        paperValue: null,
        typedValue: body.values["pod.exceptionNote"] ?? null,
        verdict: result.verdict.state,
        action: "claim_draft",
        modelCalls: result.modelCalls,
      });
    }
  } catch (error) {
    console.error("audit write failed", error);
  }
  return NextResponse.json({ ok: true, ...result });
}
