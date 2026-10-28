import os from "node:os";

/**
 * Pick the LAN IPv4 for demo URLs: first non-internal address,
 * preferring Wi-Fi-shaped interface names. Falls back to loopback
 * when nothing else exists (never throws).
 */
export function pickLanIp(interfaces = os.networkInterfaces()) {
  const flat = [];
  for (const [name, addrs] of Object.entries(interfaces ?? {})) {
    for (const addr of addrs ?? []) {
      if (addr?.family === "IPv4" && !addr.internal) flat.push({ name, address: addr.address });
    }
  }
  const wifi = flat.find(({ name }) => /^(en0|eth0|wlan0|wi-?fi)/i.test(name));
  return (wifi ?? flat[0])?.address ?? "127.0.0.1";
}

export function lanUrl(port) {
  return `http://${pickLanIp()}:${port}`;
}
