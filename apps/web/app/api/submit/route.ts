import { NextResponse } from "next/server";
import { logAuditEntry } from "../../../lib/audit-store";
import { evaluateSubmission } from "../../../lib/gate";

interface SubmitBody {
  sessionId?: string;
  values?: Record<string, string>;
}

export async function POST(request: Request) {
  const body = (await request.json()) as SubmitBody;
  if (typeof body.sessionId !== "string" || typeof body.values !== "object" || body.values === null) {
    return NextResponse.json({ ok: false, error: "bad_submit" }, { status: 400 });
  }
  const result = evaluateSubmission(body.values);
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
      });
    } else {
      for (const failure of result.failures) {
        await logAuditEntry({
          ts,
          sessionId: body.sessionId,
          fieldId: failure.fieldId,
          paperValue: null,
          typedValue: body.values[failure.fieldId] ?? null,
          verdict: result.verdict.state,
          action: `submit_block:${failure.rule}`,
        });
      }
    }
  } catch (error) {
    console.error("audit write failed", error);
  }
  return NextResponse.json({ ok: true, ...result });
}
