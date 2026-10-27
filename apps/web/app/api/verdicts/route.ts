import { NextResponse } from "next/server";
import { subscribeLiveVerdicts } from "../../../lib/verdict-bus";

export const dynamic = "force-dynamic";

/**
 * Server-sent verdict stream for one form session. The client opens
 * /api/verdicts?sessionId=... with EventSource and receives every live
 * verdict with an incrementing session sequence number.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "bad_session" }, { status: 400 });
  }
  let unsubscribe = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client went away; cancel() below unsubscribes.
        }
      };
      send({ hello: sessionId });
      unsubscribe = subscribeLiveVerdicts(sessionId, send);
    },
    cancel() {
      unsubscribe();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
