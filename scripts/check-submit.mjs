/**
 * Submission readiness gate (`pnpm check:submit`). Fails when:
 * - a tracked file is .env (other than .env.example) or file
 *   contents match known secret shapes,
 * - user-facing copy (UI, README, DEMO, SUBMIT, SHOTLIST)
 *   contains an em dash,
 * - fixtures or seeded data name a real carrier, shipper, or
 *   hook-line-only company,
 * - a deadline doc states the old 6pm target or SUBMIT.md lacks
 *   the canonical "Nov 4, 9pm ET (event page)" / "Nov 3, 9pm ET"
 *   lines,
 * - `pnpm -r test` or `pnpm -r typecheck` fails (the headline
 *   number guard runs inside the eval suite),
 * - non-test code reads an env var missing from `.env.example`
 *   or README.md.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`check:submit: ${message}`);
}

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function walk(dir, extensions) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      found.push(...walk(path, extensions));
    } else if (extensions.some((ext) => path.endsWith(ext))) {
      found.push(path);
    }
  }
  return found;
}

// ---- 1. secrets ----
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /gho_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /MODEL_API_KEY['"]?\s*[:=]\s*['"]?[A-Za-z0-9_.-]{16,}/,
];
const BINARY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".mp4", ".woff2", ".ico"];
for (const file of trackedFiles()) {
  if (/(^|\/)\.env(\.[^/]*)?$/.test(file) && !file.endsWith(".env.example")) {
    fail(`tracked dotenv file: ${file}`);
  }
  if (BINARY_EXTENSIONS.some((ext) => file.endsWith(ext))) continue;
  let body;
  try {
    body = readFileSync(join(ROOT, file), "utf8");
  } catch {
    continue;
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(body)) fail(`possible secret (${pattern}) in ${file}`);
  }
}

// ---- 2. em dashes in user-facing copy ----
const COPY_FILES = [
  ...walk(join(ROOT, "apps/web/app"), [".ts", ".tsx"]),
  ...walk(join(ROOT, "apps/web/components"), [".ts", ".tsx"]),
  ...walk(join(ROOT, "apps/web/lib"), [".ts"]).filter((path) => !path.endsWith(".test.ts")),
  join(ROOT, "README.md"),
  join(ROOT, "docs/DEMO.md"),
  join(ROOT, "docs/SUBMIT.md"),
  join(ROOT, "docs/SHOTLIST.md"),
];
for (const path of COPY_FILES) {
  const body = readFileSync(path, "utf8");
  if (body.includes("—")) {
    fail(`em dash in user-facing copy: ${path.slice(ROOT.length + 1)}`);
  }
}

// ---- 3. real company names in fixtures ----
const DENY = [
  "Maersk",
  "Mediterranean Shipping",
  "CMA CGM",
  "Cosco",
  "Evergreen",
  "Hapag",
  "FedEx",
  "UPS",
  "DHL",
  "C.H. Robinson",
  "XPO Logistics",
  "Citibank",
  "Revlon",
  "Lufthansa",
];
const FIXTURE_FILES = [
  join(ROOT, "apps/web/lib/demo-data.ts"),
  ...walk(join(ROOT, "apps/web/components/demo"), [".ts", ".tsx"]),
  ...walk(join(ROOT, "eval/generator/src"), [".ts"]),
  ...walk(join(ROOT, "eval/corpus"), [".json"]),
  ...walk(join(ROOT, "eval/corpus-hard"), [".json"]),
  join(ROOT, "test/fake-video/render.py"),
  join(ROOT, "test/fake-video/scenarios.mjs"),
];
for (const path of FIXTURE_FILES) {
  let body;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  // The Citibank/Revlon hook line is allowed exactly once, on /demo.
  body = body
    .split("\n")
    .filter((line) => !line.includes("wired $900M"))
    .join("\n");
  for (const name of DENY) {
    const pattern = new RegExp(`\\b${name.replace(/[./]/g, (c) => `\\${c}`)}\\b`, "i");
    if (pattern.test(body)) {
      fail(`real company name "${name}" in ${path.slice(ROOT.length + 1)}`);
    }
  }
}

// ---- 4. deadline consistency ----
const DEADLINE_DOCS = [
  join(ROOT, "docs/SUBMIT.md"),
  join(ROOT, "STATUS.md"),
  join(ROOT, "docs/DEMO.md"),
  join(ROOT, "README.md"),
  join(ROOT, "PLAN.md"),
];
const STALE_DEADLINE = /6(\s*:\s*00)?\s*pm/i;
for (const path of DEADLINE_DOCS) {
  let body;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (STALE_DEADLINE.test(body)) {
    fail(`stale 6pm deadline in ${path.slice(ROOT.length + 1)} (want Nov 4, 9pm ET (event page) / Nov 3, 9pm ET)`);
  }
}
const submitBody = readFileSync(join(ROOT, "docs/SUBMIT.md"), "utf8");
for (const line of ["Nov 4, 9pm ET (event page)", "Nov 3, 9pm ET"]) {
  if (!submitBody.includes(line)) {
    fail(`docs/SUBMIT.md lacks the canonical deadline line: ${line}`);
  }
}

// ---- 5. env documentation drift ----
// Every static env read in non-test code must name a var listed in
// both .env.example and README.md. (The one dynamic read,
// loadDotEnv's allowlisted assignment, only sets names from
// DOTENV_ALLOWLIST, which are all listed.)
const ENV_DOCS = [
  { file: ".env.example", body: readFileSync(join(ROOT, ".env.example"), "utf8") },
  { file: "README.md", body: readFileSync(join(ROOT, "README.md"), "utf8") },
];
const ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)|\.getenv\("([A-Z][A-Z0-9_]*)"\)/g;
const TEST_PATH = /(^|\/)(test|tests)(\/|$)|\.test\.(mts|cts|ts|tsx|mjs|js)$/;
const readVars = new Map();
for (const file of trackedFiles()) {
  if (!/\.(mts|cts|ts|tsx|mjs|kt)$/.test(file)) continue;
  if (TEST_PATH.test(file)) continue;
  const body = readFileSync(join(ROOT, file), "utf8");
  for (const match of body.matchAll(ENV_READ)) {
    const name = match[1] ?? match[2];
    if (!readVars.has(name)) readVars.set(name, file);
  }
}
for (const [name, file] of readVars) {
  for (const doc of ENV_DOCS) {
    if (!doc.body.includes(name)) {
      fail(`env var ${name} read in ${file} but missing from ${doc.file}`);
    }
  }
}

// ---- 6/7. tests, typecheck (number guard runs in the eval suite) ----
for (const args of [
  ["-r", "test"],
  ["-r", "typecheck"],
]) {
  try {
    execFileSync("pnpm", args, { cwd: ROOT, stdio: "pipe" });
  } catch (error) {
    const out = String(error.stdout ?? error.message ?? error).slice(-2000);
    fail(`pnpm ${args.join(" ")} failed:\n${out}`);
  }
}

if (failures.length > 0) {
  console.error(`check:submit: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log("check:submit: clean");
