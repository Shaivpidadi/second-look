import { NextResponse } from "next/server";
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
  return NextResponse.json({ ok: true, ...result });
}
