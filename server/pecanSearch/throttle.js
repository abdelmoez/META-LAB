/**
 * pecanSearch/throttle.js — per-provider request start-spacing (politeness).
 *
 * The shared HTTP client handles timeouts/retries/circuit-breaking, but providers
 * also publish request-rate etiquette (NCBI 3–10/sec, Crossref/OpenAlex polite
 * pool). A connector awaits a throttle slot before each external call so call
 * STARTS are spaced — independent of how slow any individual response is.
 *
 * One throttle PER PROVIDER instance (never shared across hosts). DI clock + sleep
 * keep it deterministic under test (a fixed clock + a no-op sleep => no real wait).
 */

/**
 * makeThrottle(intervalMs, { now, sleep }) → next()
 * Serializes only the spacing, not the request, so a slow response never
 * head-of-line-blocks the next call's spacing budget.
 */
export function makeThrottle(intervalMs, { now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const interval = Math.max(0, Number(intervalMs) || 0);
  let gate = Promise.resolve();
  let lastAt = 0;
  return function next() {
    const p = gate.then(async () => {
      const wait = Math.max(0, interval - (now() - lastAt));
      if (wait) await sleep(wait);
      lastAt = now();
    });
    gate = p.catch(() => {}); // keep the chain alive on error
    return p;
  };
}
