#!/usr/bin/env node
/**
 * Fake-video end-to-end test. Renders synthetic paperwork as handheld
 * POV clips (test/fake-video/render.py), samples them at 2 fps with
 * ffmpeg, and drives a running Second Look server over the exact HTTP
 * path the Android app and /form use:
 *   - typed form values: POST /api/events {fieldId, value}
 *   - glasses frames:    POST /api/events {fieldId: "frame.pov", value: data URL, memory}
 *   - verdicts:          GET  /api/verdicts?sessionId= (SSE)
 *   - submit gate:       POST /api/submit
 * Each scenario runs in its own session, in both directions (form-first
 * and docs-first), and is scored against planted ground truth.
 *
 *   node scripts/fake-video-e2e.mjs [--base http://127.0.0.1:3100]
 *     [--only id,id] [--mode real|stub] [--frames 6] [--out test/fake-video/out]
 *     [--label name] [--no-submit] [--repeat N] [--max-spend 20]
 *
 * --mode stub scores plumbing only (stub models read no paper).
 * Prints a results table and writes <out>/results-<label>.json and .md.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandScenarios, paperFields } from "../test/fake-video/scenarios.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FFMPEG = process.env.FFMPEG_BIN ?? "/opt/homebrew/bin/ffmpeg";

export function parseArgs(argv) {
  const args = { base: "http://127.0.0.1:3100", only: null, mode: null, frames: 6, out: join(ROOT, "test/fake-video/out"), label: null, submit: true, repeat: 1, maxSpend: 20, fps: 2, typePaceMs: 150, settleMs: 2500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--base") args.base = next();
    else if (a === "--only") args.only = next().split(",");
    else if (a === "--mode") args.mode = next();
    else if (a === "--frames") args.frames = Number(next());
    else if (a === "--out") args.out = next();
    else if (a === "--label") args.label = next();
    else if (a === "--no-submit") args.submit = false;
    else if (a === "--settle") args.settleMs = Number(next());
    else if (a === "--repeat") args.repeat = Number(next());
    else if (a === "--max-spend") args.maxSpend = Number(next());
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Render (cached by content hash) and sample one doc clip to JPEG frames. */
function clipFrames(doc, typed, seed, out, maxFrames, fps) {
  const job = { type: doc.type, fields: paperFields(doc, typed), degrade: doc.degrade ?? "normal", framing: doc.framing ?? "normal", seed, seconds: Math.ceil(maxFrames / fps) + 1, fps: 10 };
  const key = createHash("sha1").update(JSON.stringify(job)).digest("hex").slice(0, 12);
  const dir = join(out, "clips", `${doc.type}-${key}`);
  const mp4 = join(dir, "clip.mp4");
  if (!existsSync(mp4)) {
    mkdirSync(dir, { recursive: true });
    const r = spawnSync("python3", [join(ROOT, "test/fake-video/render.py")], { input: JSON.stringify([{ ...job, out: mp4 }]), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`render failed: ${r.stderr}`);
  }
  if (!readdirSync(dir).some((f) => f.endsWith(".jpg"))) {
    // ~JPEG q60 like the Android uploader.
    const r = spawnSync(FFMPEG, ["-loglevel", "error", "-i", mp4, "-vf", `fps=${fps}`, "-q:v", "5", join(dir, "f%03d.jpg")]);
    if (r.status !== 0) throw new Error(`ffmpeg sample failed: ${r.stderr}`);
  }
  return readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort().slice(0, maxFrames).map((f) => readFileSync(join(dir, f)));
}

/** Minimal SSE reader over fetch; returns a stop function. */
function openVerdicts(base, sessionId, onVerdict) {
  const controller = new AbortController();
  const ready = (async () => {
    const res = await fetch(`${base}/api/verdicts?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let resolveHello;
    const hello = new Promise((r) => (resolveHello = r));
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const data = JSON.parse(line.slice(6));
            if (data.hello) resolveHello();
            else onVerdict(data, performance.now());
          }
        }
      } catch {
        // aborted
      }
    })();
    await hello;
  })();
  return { ready, stop: () => controller.abort() };
}

async function health(base) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return await res.json();
      last = new Error(`health ${res.status}`);
    } catch (error) {
      last = error;
    }
    await sleep(1000);
  }
  throw last;
}

async function postJson(base, path, body) {
  const started = performance.now();
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: `non-json ${res.status}` }));
  return { status: res.status, json, ms: performance.now() - started, started };
}

function norm(id) {
  return String(id).toLowerCase();
}

/** True when a reported field id names the expected one (model ids vary in prefix). */
export function fieldMatches(reported, expected) {
  const r = norm(reported);
  const e = norm(expected);
  if (r === e) return true;
  const tail = e.split(".").pop();
  return r === tail || r.endsWith(`.${tail}`);
}

const ABSTAIN_RULES = new Set(["unreadable", "low_confidence"]);

async function typeForm(base, sessionId, typed, paceMs, log) {
  for (const [fieldId, value] of Object.entries(typed)) {
    const r = await postJson(base, "/api/events", { sessionId, fieldId, value, ts: new Date().toISOString() });
    log.push({ kind: "type", fieldId, value, status: r.status, at: r.started });
    await sleep(paceMs);
  }
}

function docFrames(scenario, args) {
  return scenario.docs.map((doc, docIndex) =>
    clipFrames(doc, scenario.typed, 100 + docIndex * 7 + scenario.caseId.length, args.out, args.frames, args.fps),
  );
}

async function streamDocs(base, sessionId, scenario, args, log, memory, onFirstFrame) {
  const pending = [];
  let docIndex = 0;
  // Clips render before the clock starts, so render time never counts as latency.
  const allFrames = docFrames(scenario, args);
  for (const doc of scenario.docs) {
    const frames = allFrames[docIndex];
    const docStart = performance.now();
    if (docIndex === 0) onFirstFrame?.(docStart);
    log.push({ kind: "doc", type: doc.type, at: docStart, frames: frames.length });
    for (const jpeg of frames) {
      const body = { sessionId, fieldId: "frame.pov", value: `data:image/jpeg;base64,${jpeg.toString("base64")}`, ts: new Date().toISOString(), memory: structuredClone(memory) };
      const p = postJson(base, "/api/events", body).then((r) => {
        const entry = { kind: "frame", doc: doc.type, status: r.status, outcome: r.json.frame ?? r.json.error, ms: r.ms, at: r.started, docStart, document: r.json.document ?? null, readings: r.json.readings ?? {}, verdicts: r.json.verdicts ?? [] };
        log.push(entry);
        if (r.json.frame === "judged" && r.json.document && r.json.readings && Object.keys(r.json.readings).length > 0) {
          memory[r.json.document] = { ...r.json.readings };
        }
      });
      pending.push(p);
      await sleep(1000 / args.fps);
    }
    docIndex++;
    await sleep(800); // swap paper
  }
  await Promise.all(pending);
}

export async function runScenario(scenario, args) {
  const sessionId = `fv-${scenario.id.replace(/[^a-z0-9]+/gi, "-")}-${Date.now().toString(36)}`;
  const verdicts = [];
  const sse = openVerdicts(args.base, sessionId, (v, at) => verdicts.push({ ...v, at }));
  await sse.ready;
  const log = [];
  const memory = {};
  const t0 = performance.now();
  let triggerAt;
  if (scenario.direction === "form-first") {
    await typeForm(args.base, sessionId, scenario.typed, args.typePaceMs, log);
    await streamDocs(args.base, sessionId, scenario, args, log, memory, (at) => (triggerAt = at));
  } else {
    await streamDocs(args.base, sessionId, scenario, args, log, memory);
    await sleep(500);
    triggerAt = performance.now();
    await typeForm(args.base, sessionId, scenario.typed, args.typePaceMs, log);
  }
  await sleep(args.settleMs);
  // A frame skipped while a judge ran is parked and judged afterwards;
  // wait for it (bounded) so its verdict is scored, then let SSE drain.
  const waitUntil = performance.now() + 20_000;
  for (;;) {
    const status = await fetch(`${args.base}/api/sessions/status?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : { judging: false }))
      .catch(() => ({ judging: false }));
    if (!status.judging || performance.now() > waitUntil) break;
    await sleep(250);
  }
  await sleep(300);
  let submit = null;
  if (args.submit) {
    const r = await postJson(args.base, "/api/submit", { sessionId, values: scenario.typed });
    submit = { status: r.status, decision: r.json.decision, failures: r.json.failures ?? [], claim: Boolean(r.json.claim), ms: r.ms };
  }
  sse.stop();
  return score(scenario, { sessionId, verdicts, log, submit, t0, triggerAt, memory });
}

export function score(scenario, run) {
  const flags = [];
  const abstains = [];
  for (const v of run.verdicts) {
    for (const f of v.failures ?? []) {
      const item = { fieldId: f.fieldId, rule: f.rule, message: f.message, fix: f.fix, source: v.fieldId, at: v.at };
      (ABSTAIN_RULES.has(f.rule) ? abstains : flags).push(item);
    }
  }
  const expected = scenario.expect.flags;
  const caught = expected.map((e) => {
    const hit = flags.filter((f) => fieldMatches(f.fieldId, e)).sort((a, b) => a.at - b.at)[0];
    return { field: e, hit: hit ?? null, latencyMs: hit ? Math.max(0, hit.at - run.triggerAt) : null };
  });
  const unexpected = flags.filter((f) => !expected.some((e) => fieldMatches(f.fieldId, e)) && !relatedFlag(f, expected));
  const frames = run.log.filter((l) => l.kind === "frame");
  const judged = frames.filter((f) => f.outcome === "judged");
  const throttled = frames.filter((f) => f.outcome === "throttled");
  const errors = frames.filter((f) => f.status >= 400);
  const docsJudged = new Set(judged.map((f) => f.doc));
  const missedDocs = scenario.docs.map((d) => d.type).filter((t) => !docsJudged.has(t));
  const allCaught = caught.every((c) => c.hit !== null);
  // An abstention counts only when it names the planted field (or the whole frame).
  const abstainOk = scenario.expect.allowAbstain && abstains.some((a) => a.fieldId === "frame.pov" || expected.some((e) => fieldMatches(a.fieldId, e)));
  let live;
  if (expected.length === 0) live = unexpected.length === 0 ? "PASS" : "FAIL";
  else live = allCaught && unexpected.length === 0 ? "PASS" : allCaught ? "PASS*" : abstainOk ? "PASS (abstain)" : "FAIL";
  let submitResult = "n/a";
  if (run.submit && scenario.expect.blockOnSubmit !== null) {
    const blocked = run.submit.decision === "BLOCK";
    submitResult = blocked === scenario.expect.blockOnSubmit ? "PASS" : "FAIL";
    if (scenario.expect.claim && !run.submit.claim) submitResult = "FAIL";
  }
  const reasons = [];
  for (const c of caught) if (!c.hit) reasons.push(`missed ${c.field}`);
  for (const u of unexpected) reasons.push(`unexpected ${u.fieldId}/${u.rule} via ${u.source}: ${u.message}`);
  // Parked frames are judged off the POST path, so a doc with no judged
  // POST may still have been judged; only worth noting when something was missed.
  if (missedDocs.length && !live.startsWith("PASS")) reasons.push(`no judged POST for: ${missedDocs.join(",")}`);
  if (errors.length) reasons.push(`${errors.length} frame errors (${[...new Set(errors.map((e) => e.outcome))].join(",")})`);
  if (run.submit && submitResult === "FAIL") reasons.push(`submit ${run.submit.decision}${scenario.expect.claim ? ` claim=${run.submit.claim}` : ""} [${run.submit.failures.map((f) => f.fieldId + "/" + f.rule).join(", ")}]`);
  return {
    id: scenario.id,
    caseId: scenario.caseId,
    title: scenario.title,
    direction: scenario.direction,
    order: scenario.order,
    sessionId: run.sessionId,
    live,
    submit: submitResult,
    detectLatencyMs: caught.map((c) => c.latencyMs).filter((x) => x !== null),
    frameMs: judged.map((f) => Math.round(f.ms)),
    frames: frames.length,
    judged: judged.length,
    throttled: throttled.length,
    abstains: abstains.map((a) => `${a.fieldId}/${a.rule}`),
    reasons,
    readings: judged.map((f) => ({ doc: f.doc, document: f.document, readings: f.readings })),
    verdicts: run.verdicts.map((v) => ({ fieldId: v.fieldId, state: v.state, decision: v.decision, failures: v.failures, dt: Math.round(v.at - run.t0) })),
    submitDetail: run.submit,
  };
}

/** Count-mismatch side effects of a planted count error are expected, not false positives. */
function relatedFlag(flag, expected) {
  const counts = ["bol.cartons", "pod.receivedCartons"];
  return counts.some((c) => fieldMatches(flag.fieldId, c)) && expected.some((e) => counts.some((c) => fieldMatches(e, c)));
}

function pct(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(results, callsUsed, meta, spendUsd = null) {
  const frameMs = results.flatMap((r) => r.frameMs);
  const detect = results.flatMap((r) => r.detectLatencyMs);
  const lines = [];
  lines.push(`# Fake-video E2E: ${meta.label}`);
  lines.push("");
  lines.push(`Server ${meta.base}, mode ${meta.mode}, ${meta.when}. Model calls this run: ${callsUsed ?? "unknown"}, estimated spend $${spendUsd === null ? "unknown" : spendUsd.toFixed(2)} (Spark Standard rates, no cache discount).`);
  lines.push("");
  lines.push("| scenario | direction / order | live | submit | detect ms | judged/frames | throttled | notes |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: | --- |");
  for (const r of results) {
    lines.push(`| ${r.caseId} | ${r.direction === "form-first" && r.order.includes(">") && r.caseId.startsWith("xdoc") ? r.order : r.direction} | ${r.live} | ${r.submit} | ${r.detectLatencyMs.map((x) => Math.round(x)).join(",") || "-"} | ${r.judged}/${r.frames} | ${r.throttled} | ${r.reasons.join("; ").replace(/\|/g, "/").slice(0, 300) || (r.abstains.length ? "abstain: " + r.abstains.join(",") : "")} |`);
  }
  const pass = results.filter((r) => r.live.startsWith("PASS") && (r.submit.startsWith("PASS") || r.submit === "n/a")).length;
  lines.push("");
  lines.push(`Passed ${pass}/${results.length}. Judged-frame POST latency p50 ${pct(frameMs, 50) ?? "-"} ms, p90 ${pct(frameMs, 90) ?? "-"} ms (n=${frameMs.length}). Detection latency (trigger to first flag) p50 ${detect.length ? Math.round(pct(detect, 50)) : "-"} ms, p90 ${detect.length ? Math.round(pct(detect, 90)) : "-"} ms (n=${detect.length}).`);
  return { markdown: lines.join("\n"), pass, total: results.length, frameP50: pct(frameMs, 50), frameP90: pct(frameMs, 90), detectP50: pct(detect, 50), detectP90: pct(detect, 90) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const h0 = await health(args.base).catch((e) => {
    throw new Error(`server not reachable at ${args.base}: ${e.message}`);
  });
  const mode = args.mode ?? h0.mode;
  if (mode === "real" && h0.mode !== "real") throw new Error("server is in stub mode; start it with SECOND_LOOK_MODELS=real");
  let scenarios = expandScenarios();
  if (args.only) scenarios = scenarios.filter((s) => args.only.some((o) => s.id === o || s.caseId === o || s.id.startsWith(o)));
  const label = args.label ?? `${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  mkdirSync(args.out, { recursive: true });
  console.log(`fake-video e2e: ${scenarios.length} scenarios against ${args.base} (${mode})`);
  for (const s of scenarios) docFrames(s, args); // pre-render every clip
  const results = [];
  const runList = Array.from({ length: args.repeat }, () => scenarios).flat();
  for (const s of runList) {
    const hNow = await health(args.base);
    const spent = typeof hNow.spendUsd === "number" && typeof h0.spendUsd === "number" ? hNow.spendUsd - h0.spendUsd : 0;
    if (spent > args.maxSpend) {
      console.log(`stopping: run spend $${spent.toFixed(2)} passed --max-spend $${args.maxSpend}`);
      break;
    }
    const r = await runScenario(s, args);
    if (mode === "stub") {
      // Stub models read no paper: score plumbing only.
      const ok = r.reasons.every((x) => x.startsWith("missed") || x.startsWith("submit")) && r.judged > 0 && r.reasons.filter((x) => x.includes("frame errors")).length === 0;
      r.live = ok ? "PASS (plumbing)" : "FAIL";
      r.submit = r.submitDetail && r.submitDetail.status === 200 ? "PASS (plumbing)" : "FAIL";
    }
    results.push(r);
    console.log(`${r.live.padEnd(15)} submit ${r.submit.padEnd(15)} ${r.id}  judged ${r.judged}/${r.frames}${r.reasons.length ? "  :: " + r.reasons.join("; ") : ""}`);
  }
  const h1 = await health(args.base);
  const callsUsed = typeof h1.modelCalls === "number" && typeof h0.modelCalls === "number" ? h1.modelCalls - h0.modelCalls : null;
  const spendUsd = typeof h1.spendUsd === "number" && typeof h0.spendUsd === "number" && h1.spendUsd >= h0.spendUsd ? h1.spendUsd - h0.spendUsd : null;
  const summary = summarize(results, callsUsed, { label, base: args.base, mode, when: new Date().toString() }, spendUsd);
  writeFileSync(join(args.out, `results-${label}.json`), JSON.stringify({ label, mode, callsUsed, spendUsd, summary: { ...summary, markdown: undefined }, results }, null, 2));
  writeFileSync(join(args.out, `results-${label}.md`), summary.markdown + "\n");
  console.log("\n" + summary.markdown);
  process.exitCode = summary.pass === summary.total ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
