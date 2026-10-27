import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Shared Model API key lookup. The key is read from the environment at call
 * time (never cached) so tests and CLIs can set it late. `MODEL_API_KEY` is
 * preferred; `META_API_KEY` is accepted as an alias.
 */
export function requireModelApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = env.MODEL_API_KEY ?? env.META_API_KEY;
  if (!key) {
    throw new Error(
      "MODEL_API_KEY is not set (alias META_API_KEY). Copy .env.example to " +
        ".env and add a Meta Model API key; see PLAN.md. The tiered pipeline " +
        "stays on stub adapters until a key exists.",
    );
  }
  return key;
}

/**
 * Env vars a `.env` file may provide. Anything else in the file is ignored
 * so a stray line can never reconfigure the process.
 */
const DOTENV_ALLOWLIST = new Set([
  "MODEL_API_KEY",
  "META_API_KEY",
  "MODEL_API_BASE_URL",
  "SECOND_LOOK_MODELS",
  "SECOND_LOOK_CALL_BUDGET",
]);

function parseDotEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  const at = trimmed.indexOf("=");
  if (at <= 0) return null;
  const name = trimmed.slice(0, at).trim();
  let value = trimmed.slice(at + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  if (!DOTENV_ALLOWLIST.has(name) || value === "") return null;
  return [name, value];
}

/**
 * Load the nearest `.env` file (walking up from `startDir`) into
 * `process.env`, without overriding vars that are already set. CLI entry
 * points call this at startup; library code only reads `process.env`, so
 * tests stay hermetic. Returns the loaded path, or null when no `.env`
 * exists. Never prints values.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, "utf8").split("\n")) {
        const parsed = parseDotEnvLine(line);
        if (parsed && process.env[parsed[0]] === undefined) {
          process.env[parsed[0]] = parsed[1];
        }
      }
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
