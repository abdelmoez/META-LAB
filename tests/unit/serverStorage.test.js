/**
 * serverStorage.test.js
 *
 * Unit tests for the window.storage bridge defined in
 * src/frontend/storage/serverStorage.js.
 *
 * Strategy: the module sets window.storage as a side-effect when imported.
 * We run in the default Node environment and stub window + fetch globally
 * using vi.stubGlobal before dynamic-importing the module so the
 * assignment resolves against our stub.  After each test we restore fetch
 * so mocks don't bleed between tests.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

/* ── Shared storage reference ─────────────────────────────────────────── */

let storage;           // window.storage set by the module
let subscribeToSaveStatus;

// The module uses `window.storage = { ... }` at the top level.
// We need window to exist in the Node environment before the import runs.
beforeAll(async () => {
  // Provide a window global (Node has no window by default)
  const win = {};
  vi.stubGlobal('window', win);

  // Provide a fetch global — we'll override it per-test
  vi.stubGlobal('fetch', vi.fn());

  // Dynamic import so the stub is in place when the module executes
  const mod = await import('../../src/frontend/storage/serverStorage.js');
  subscribeToSaveStatus = mod.subscribeToSaveStatus;
  storage = win.storage;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── Helper: build a minimal fetch mock ──────────────────────────────── */

/**
 * Build a Response-like object.
 * @param {*}      body    – will be JSON-serialised
 * @param {number} status  – HTTP status code (default 200)
 */
function mockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

/* ══════════════════════════════════════════════════════════════════════
   get()
   ══════════════════════════════════════════════════════════════════════ */

describe('window.storage.get', () => {
  it('returns { value: "[]" } when server returns an empty project list', async () => {
    // GET /api/projects → []
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse([])));

    const result = await storage.get('meta:projects');

    expect(result).toEqual({ value: '[]' });
  });

  it('fetches full project data for each project in the list', async () => {
    const list = [{ id: 'aaa' }, { id: 'bbb' }];
    const fullA = { id: 'aaa', name: 'Project A', studies: [{ id: 's1' }] };
    const fullB = { id: 'bbb', name: 'Project B', studies: [] };

    // First call → list; subsequent calls → individual project data
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(mockResponse(list))   // GET /api/projects
        .mockResolvedValueOnce(mockResponse(fullA))  // GET /api/projects/aaa
        .mockResolvedValueOnce(mockResponse(fullB)), // GET /api/projects/bbb
    );

    const result = await storage.get('meta:projects');
    expect(result).not.toBeNull();

    const parsed = JSON.parse(result.value);
    expect(parsed).toHaveLength(2);
    // Both full objects should be present (order may vary)
    const ids = parsed.map(p => p.id).sort();
    expect(ids).toEqual(['aaa', 'bbb']);
    // studies array should be included
    const projA = parsed.find(p => p.id === 'aaa');
    expect(projA.studies).toEqual([{ id: 's1' }]);
  });

  it('returns null for any key other than "meta:projects"', async () => {
    // fetch should never be called for unknown keys
    vi.stubGlobal('fetch', vi.fn());

    const result = await storage.get('some:other:key');
    expect(result).toBeNull();

    // Confirm fetch was NOT called
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns null when fetch throws a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error')),
    );

    const result = await storage.get('meta:projects');
    expect(result).toBeNull();
  });

  it('returns null when the server returns a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ error: 'Unauthorized' }, 401)));

    const result = await storage.get('meta:projects');
    expect(result).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   set()
   ══════════════════════════════════════════════════════════════════════ */

describe('window.storage.set', () => {
  it('calls the autosave endpoint for each project in the array', async () => {
    const projects = [
      { id: 'p1', name: 'Alpha', studies: [] },
      { id: 'p2', name: 'Beta',  studies: [] },
    ];

    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await storage.set('meta:projects', JSON.stringify(projects));

    // Should have been called at least twice — once per project autosave
    const autosaveCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => typeof url === 'string' && url.includes('/autosave') && opts?.method === 'PUT',
    );
    expect(autosaveCalls).toHaveLength(2);

    const urls = autosaveCalls.map(([url]) => url);
    expect(urls).toContain('/api/projects/p1/autosave');
    expect(urls).toContain('/api/projects/p2/autosave');
  });

  it('calls DELETE for projects that were removed from the local array', async () => {
    // Step 1: get() so knownServerIds is populated with ['x1', 'x2']
    const list = [{ id: 'x1' }, { id: 'x2' }];
    const fullX1 = { id: 'x1', name: 'X1', studies: [] };
    const fullX2 = { id: 'x2', name: 'X2', studies: [] };

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(mockResponse(list))
        .mockResolvedValueOnce(mockResponse(fullX1))
        .mockResolvedValueOnce(mockResponse(fullX2)),
    );
    await storage.get('meta:projects'); // populates knownServerIds = {x1, x2}

    // Step 2: set() with only x1 — x2 should be deleted
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await storage.set('meta:projects', JSON.stringify([{ id: 'x1', name: 'X1', studies: [] }]));

    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => typeof url === 'string' && url.includes('/api/projects/x2') && opts?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(1);
  });

  it('emits "failed" status when the JSON value is invalid', async () => {
    const statuses = [];
    const unsub = subscribeToSaveStatus(s => statuses.push(s));

    vi.stubGlobal('fetch', vi.fn());

    await storage.set('meta:projects', 'not-valid-json{{{');

    unsub();

    // Must have emitted 'saving' then 'failed'
    expect(statuses).toContain('saving');
    expect(statuses).toContain('failed');
    // fetch should never be called when JSON is invalid
    expect(fetch).not.toHaveBeenCalled();
  });

  it('emits "failed" when the value parses to a non-array', async () => {
    const statuses = [];
    const unsub = subscribeToSaveStatus(s => statuses.push(s));

    vi.stubGlobal('fetch', vi.fn());

    // JSON is valid but not an array
    await storage.set('meta:projects', JSON.stringify({ id: 'p1' }));

    unsub();

    expect(statuses).toContain('saving');
    expect(statuses).toContain('failed');
  });

  it('emits "saving" then "saved" on a successful set', async () => {
    const statuses = [];
    const unsub = subscribeToSaveStatus(s => statuses.push(s));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: true })));

    await storage.set('meta:projects', JSON.stringify([{ id: 'q1', name: 'QA', studies: [] }]));

    unsub();

    expect(statuses[0]).toBe('saving');
    expect(statuses).toContain('saved');
  });

  it('does nothing (no fetch) when the key is not "meta:projects"', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await storage.set('unrelated:key', '[]');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   subscribeToSaveStatus
   ══════════════════════════════════════════════════════════════════════ */

describe('subscribeToSaveStatus', () => {
  it('returns an unsubscribe function that stops further callbacks', async () => {
    const statuses = [];
    const unsub = subscribeToSaveStatus(s => statuses.push(s));

    // Trigger one save so 'saving' is emitted
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ ok: true })));
    await storage.set('meta:projects', JSON.stringify([{ id: 'r1', name: 'R1', studies: [] }]));

    const countAfterFirst = statuses.length;
    expect(countAfterFirst).toBeGreaterThanOrEqual(2); // at least 'saving' + 'saved'

    unsub(); // unsubscribe

    // Trigger another save
    await storage.set('meta:projects', JSON.stringify([{ id: 'r1', name: 'R1', studies: [] }]));

    // No new statuses should have been added
    expect(statuses.length).toBe(countAfterFirst);
  });
});
