/**
 * Screenshot harness for the batch-9 UI critique loop.
 *
 * Assumes a built app serving BASE (default http://127.0.0.1:3100).
 * Seeds audit + claim data through the real /api/submit, then captures
 * every page at 1440x900 and key screens at 1920x1080 into docs/shots/.
 *
 * Run:  pnpm --filter @second-look/web build
 *       pnpm --filter @second-look/web exec next start -p 3100 &
 *       node --experimental-strip-types apps/web/scripts/shots.mts
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const BASE = process.env.SHOTS_BASE ?? "http://127.0.0.1:3100";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../../docs/shots");
mkdirSync(OUT, { recursive: true });

const CLEAN = {
  "awb.awbNumber": "02027342210",
  "bol.bolNumber": "BOL-00421307",
  "bol.carrier": "HARBOUR LINE GOODS",
  "bol.containerNumber": "CSQU3054383",
  "label.sscc": "106141410000001238",
  "bol.cartons": "120",
  "pod.receivedCartons": "120",
  "pod.exceptionNote": "",
};

async function seed(sessionId: string, values: Record<string, string>): Promise<void> {
  const res = await fetch(`${BASE}/api/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, values }),
  });
  if (!res.ok) throw new Error(`seed ${sessionId} failed: HTTP ${res.status}`);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, name) });
  console.log("shot", name);
}

async function main(): Promise<void> {
  // Fresh audit log per shoot so runs never duplicate across reshoots.
  // (Restart the server too: claim drafts live in server memory.)
  rmSync(join(dirname(fileURLToPath(import.meta.url)), "../.audit"), { recursive: true, force: true });
  // Seed three runs: blocked, short-count block, damage claim.
  await seed("shots-blocked", { ...CLEAN, "awb.awbNumber": "02027342201" });
  await seed("shots-short", { ...CLEAN, "pod.receivedCartons": "118" });
  await seed("shots-claim", {
    ...CLEAN,
    "pod.receivedCartons": "118",
    "pod.exceptionNote": "2 cartons damaged",
  });

  // Sandboxed runs cannot install Playwright browsers; use system Chrome.
  const browser = await chromium.launch({
    executablePath:
      process.env.SHOTS_CHROME ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    // ---- landing ----
    const landing = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    landing.on("pageerror", (e) => console.error("landing pageerror:", e.message));
    await landing.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await shot(landing, "landing-1440.png");
    await landing.setViewportSize({ width: 1920, height: 1080 });
    await landing.waitForTimeout(400);
    await shot(landing, "landing-1920.png");
    await landing.setViewportSize({ width: 1440, height: 900 });
    await landing.screenshot({ path: join(OUT, "landing-full.png"), fullPage: true });
    console.log("shot landing-full.png");
    await landing.close();

    // ---- form ----
    const form = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    form.on("pageerror", (e) => console.error("form pageerror:", e.message));
    await form.goto(`${BASE}/form`, { waitUntil: "networkidle" });
    await form.waitForTimeout(800);
    await shot(form, "form-1440.png");
    // Type the AWB typo to light up the live-verdict rail + inline error.
    const awb = form.locator('input[name="awb.awbNumber"], input[id="awb.awbNumber"]');
    if ((await awb.count()) > 0) {
      await awb.first().fill("02027342201");
      await form.waitForTimeout(1500);
      await shot(form, "form-typo-1440.png");
    } else {
      console.log("skip form-typo: AWB input not found");
    }
    await form.close();

    // ---- dashboard ----
    const dash = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    dash.on("pageerror", (e) => console.error("dashboard pageerror:", e.message));
    await dash.goto(`${BASE}/dashboard?session=demo`, { waitUntil: "networkidle" });
    await dash.waitForTimeout(2500); // session load + one poll
    await shot(dash, "dashboard-overview-1440.png");
    await dash.getByRole("button", { name: "Checks" }).click();
    await dash.waitForTimeout(500);
    await shot(dash, "dashboard-checks-1440.png");
    // Open the first check drawer.
    const firstRow = dash.locator("tbody tr").first();
    await firstRow.click();
    await dash.waitForTimeout(500);
    await shot(dash, "dashboard-drawer-1440.png");
    await dash.keyboard.press("Escape").catch(() => {});
    await dash.getByRole("button", { name: "Close check detail" }).click().catch(() => {});
    await dash.goto(`${BASE}/dashboard?session=demo`, { waitUntil: "networkidle" });
    await dash.waitForTimeout(2500);
    await dash.getByRole("button", { name: "Claims" }).click();
    await dash.waitForTimeout(500);
    await shot(dash, "dashboard-claims-1440.png");
    await dash.getByRole("button", { name: "Audit log" }).click();
    await dash.waitForTimeout(500);
    await shot(dash, "dashboard-audit-1440.png");
    await dash.getByRole("button", { name: "Eval" }).click();
    await dash.waitForTimeout(500);
    await shot(dash, "dashboard-eval-1440.png");
    await dash.close();

    // ---- demo ----
    const demo = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    demo.on("pageerror", (e) => console.error("demo pageerror:", e.message));
    await demo.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
    await demo.waitForTimeout(800);
    await shot(demo, "demo-title-1920.png");
    await demo.getByRole("button", { name: /start the demo/i }).click();
    await demo.waitForTimeout(3200); // fixture cards stream in
    await shot(demo, "demo-step1-1920.png");
    await demo.keyboard.press("ArrowRight");
    await demo.waitForTimeout(2600);
    await shot(demo, "demo-step2-1920.png");
    await demo.keyboard.press("ArrowRight");
    await demo.waitForTimeout(2600);
    await shot(demo, "demo-step3-1920.png");
    await demo.keyboard.press("ArrowRight");
    await demo.waitForTimeout(2600);
    await shot(demo, "demo-step4-1920.png");
    await demo.close();
  } finally {
    await browser.close();
  }
  console.log("done ->", OUT);
}

await main();
