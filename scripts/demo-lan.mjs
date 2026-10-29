import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lanUrl } from "./demo-net.mjs";

export const DEMO_PORT = Number(process.env.PORT ?? 3100);

/**
 * pnpm args that start the web app bound to all interfaces. `exec next`
 * passes the flags straight to Next; `dev -- -p` forwarded a literal
 * "--" and Next read it as the project dir ("Invalid project directory
 * .../-p").
 */
export function devArgs(port) {
  return ["--filter", "@second-look/web", "exec", "next", "dev", "-p", String(port), "-H", "0.0.0.0"];
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(`Starting the server for LAN play; point the app at ${lanUrl(DEMO_PORT)}`);
  const child = spawn("pnpm", devArgs(DEMO_PORT), { cwd: root, stdio: "inherit" });
  const code = await new Promise((resolve) => child.on("close", resolve));
  process.exitCode = typeof code === "number" ? code : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
