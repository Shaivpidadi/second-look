import { NextResponse } from "next/server";
import { getClaimDrafts } from "../../../lib/claim-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "bad_session" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, sessionId, claims: getClaimDrafts(sessionId) });
}
