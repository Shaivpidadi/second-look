import { fileURLToPath } from "node:url";
import { lanUrl } from "./demo-net.mjs";

export const DEMO_PORT = Number(process.env.PORT ?? 3100);

/**
 * Probe the local server's health endpoint. Returns per-item results;
 * unreachable servers report cleanly instead of throwing.
 */
export async function checkHealth(baseUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { reachable: true, ok: false, mode: "unknown", keyPresent: false };
    }
    const body = await res.json();
    return {
      reachable: true,
      ok: body?.ok === true,
      mode: typeof body?.mode === "string" ? body.mode : "unknown",
      keyPresent: body?.keyPresent === true,
    };
  } catch {
    return { reachable: false, ok: false, mode: "unknown", keyPresent: false };
  }
}

function row(pass, label, hint) {
  console.log(`${pass ? "PASS" : "FAIL"}: ${label}${hint ? ` (${hint})` : ""}`);
  return pass;
}

async function main() {
  const base = `http://127.0.0.1:${DEMO_PORT}`;
  const health = await checkHealth(base);
  let allPass = true;
  allPass =
    row(health.reachable, "Server reachable", health.reachable ? base : "run pnpm demo:lan") &&
    allPass;
  allPass = row(health.reachable && health.ok, "Server healthy", `mode: ${health.mode}`) && allPass;
  allPass =
    row(health.keyPresent, "API key present", health.keyPresent ? "live models armed" : "set MODEL_API_KEY in .env, restart") &&
    allPass;
  console.log(`LAN URL for the app: ${lanUrl(DEMO_PORT)}`);
  if (!allPass) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
