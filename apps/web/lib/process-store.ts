/**
 * Process-wide singleton maps. `next dev` compiles each route on first
 * hit and can evaluate a shared module more than once, so plain
 * module-level maps split across routes: a frame judged via /api/events
 * was invisible to /api/submit and to an SSE stream compiled a moment
 * earlier (seen in the fake-video E2E on a cold server). Keying the
 * maps on globalThis keeps one copy per process in dev and prod.
 */
export function processMap<K, V>(name: string): Map<K, V> {
  const key = Symbol.for(`second-look.${name}`);
  const holder = globalThis as unknown as Record<symbol, Map<K, V> | undefined>;
  let map = holder[key];
  if (!map) {
    map = new Map<K, V>();
    holder[key] = map;
  }
  return map;
}
