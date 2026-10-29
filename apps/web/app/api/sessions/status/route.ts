import { NextResponse } from "next/server";
import { frameSessionJudging } from "../../../../lib/frame-path";

/**
 * Whether a session still has a frame judge running or parked:
 * `{ judging: boolean }`. Test harnesses poll it to wait for the last
 * verdict of a sweep.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  return NextResponse.json({ judging: frameSessionJudging(sessionId) });
}
