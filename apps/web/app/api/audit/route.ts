import { NextResponse } from "next/server";
import { getAuditSessions, getSessionAudit } from "../../../lib/audit-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (sessionId) {
    const entries = await getSessionAudit(sessionId);
    return NextResponse.json({ ok: true, sessionId, entries });
  }
  const sessions = await getAuditSessions();
  return NextResponse.json({ ok: true, sessions });
}
