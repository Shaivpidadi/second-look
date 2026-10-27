import { NextResponse } from "next/server";

export interface FormEvent {
  sessionId: string;
  fieldId: string;
  value: string;
  ts: string;
}

const store = new Map<string, FormEvent[]>();

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
  return NextResponse.json({ ok: true, count: list.length });
}
