import { NextResponse } from "next/server";
import { latestFrameSession } from "../../../../lib/frame-path";

/**
 * The glasses session that sent a frame most recently, so the form can
 * join it (`/form?session=glasses`) and typed values meet the paper the
 * phone read. Returns `{ session: null }` when no phone is streaming.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ session: latestFrameSession() });
}
