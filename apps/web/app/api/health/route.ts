import { NextResponse } from "next/server";
import { resolveModelMode } from "@second-look/pipeline";

/**
 * Demo-day preflight probe. Reports whether a model key is configured
 * (present or missing, never the value) and which adapter mode the
 * server runs; the Android Check-setup screen and `pnpm demo:preflight`
 * read this before anything streams.
 */
export async function GET() {
  const keyPresent = Boolean(process.env.MODEL_API_KEY ?? process.env.META_API_KEY);
  return NextResponse.json({
    ok: true,
    mode: resolveModelMode(),
    keyPresent,
  });
}
