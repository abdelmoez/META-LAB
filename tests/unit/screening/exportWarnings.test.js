/**
 * 97.md L-fix — serializeJobWarnings (server/services/screeningExportWorker.js).
 * The stored ScreenExportJob.warnings payload must ALWAYS be valid JSON: a naive
 * `JSON.stringify(list).slice(0, 4000)` could cut mid-token, making getExportJob
 * degrade to `warnings: []` while warningCount stays > 0 — which silently
 * suppressed the non-blocking UI banner. These tests pin: per-item capping,
 * whole-item dropping (never mid-string JSON cuts), and parseability at every cap.
 */
import { describe, it, expect } from 'vitest';
import { serializeJobWarnings } from '../../../server/services/screeningExportWorker.js';

describe('serializeJobWarnings — always-valid bounded JSON', () => {
  it('round-trips a normal warning list unchanged', () => {
    const list = ['references.ris could not be generated: boom. The CSV and JSON files in this export are complete.'];
    expect(JSON.parse(serializeJobWarnings(list))).toEqual(list);
  });

  it('caps each warning message at the item cap', () => {
    const long = 'x'.repeat(5000);
    const out = JSON.parse(serializeJobWarnings([long, 'short']));
    expect(out[0].length).toBe(500);
    expect(out[1]).toBe('short');
  });

  it('a driver-error-sized message can never yield unparseable storage', () => {
    // The exact failure mode of the old `.slice(0, 4000)`: one long message with
    // JSON-escaping characters cut mid-escape.
    const nasty = ('prisma error "quote" \\backslash\\ \n newline '.repeat(200));
    const stored = serializeJobWarnings([nasty]);
    expect(stored.length).toBeLessThanOrEqual(4000);
    expect(() => JSON.parse(stored)).not.toThrow();
    expect(JSON.parse(stored).length).toBe(1);
  });

  it('drops whole trailing items (never mid-string cuts) when the total cap is hit', () => {
    const items = Array.from({ length: 20 }, (_, i) => `warning ${i}: ` + 'detail '.repeat(60));
    const stored = serializeJobWarnings(items, { itemCap: 500, totalCap: 1000 });
    expect(stored.length).toBeLessThanOrEqual(1000);
    const parsed = JSON.parse(stored);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBeLessThan(items.length);
    // Every surviving item is a complete original (capped) message.
    parsed.forEach((w, i) => expect(w).toBe(items[i].slice(0, 500)));
  });

  it('degenerate inputs stay valid JSON', () => {
    expect(JSON.parse(serializeJobWarnings([]))).toEqual([]);
    expect(JSON.parse(serializeJobWarnings(null))).toEqual([]);
    expect(JSON.parse(serializeJobWarnings([null, 42]))).toEqual(['', '42']);
  });
});
