import test from "node:test";
import assert from "node:assert/strict";
import { pickLanIp } from "./demo-net.mjs";
import { checkHealth } from "./demo-preflight.mjs";
import { devArgs } from "./demo-lan.mjs";

test("demo-net: prefers Wi-Fi IPv4, falls back to loopback", () => {
  const ifaces = {
    lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
    en1: [{ family: "IPv4", internal: false, address: "10.0.0.9" }],
    en0: [{ family: "IPv4", internal: false, address: "192.168.1.20" }],
  };
  assert.equal(pickLanIp(ifaces), "192.168.1.20");
  assert.equal(pickLanIp({ lo0: ifaces.lo0 }), "127.0.0.1");
  assert.equal(pickLanIp({}), "127.0.0.1");
});

test("demo-preflight: parses health, reports unreachable cleanly", async () => {
  const ok = async () => ({ ok: true, json: async () => ({ ok: true, mode: "real", keyPresent: true }) });
  assert.deepEqual(await checkHealth("http://x", ok), {
    reachable: true,
    ok: true,
    mode: "real",
    keyPresent: true,
  });
  const down = async () => {
    throw new Error("refused");
  };
  assert.deepEqual(await checkHealth("http://x", down), {
    reachable: false,
    ok: false,
    mode: "unknown",
    keyPresent: false,
  });
  const sick = async () => ({ ok: false, json: async () => ({}) });
  const assessed = await checkHealth("http://x", sick);
  assert.equal(assessed.reachable, true);
  assert.equal(assessed.ok, false);
});

test("demo-lan: binds all interfaces on the demo port", () => {
  assert.deepEqual(devArgs(3100), [
    "--filter",
    "@second-look/web",
    "exec",
    "next",
    "dev",
    "-p",
    "3100",
    "-H",
    "0.0.0.0",
  ]);
});
