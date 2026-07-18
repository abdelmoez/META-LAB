/**
 * rate-limit-contact.test.js — the public contact-form rate limit (93.md §4 abuse
 * hardening review).
 *
 * The limiters live INLINE in server/index.js (which boots workers, DB and a
 * listener on import), so a full-app NODE_ENV=production supertest is too
 * expensive here. Instead this file pins the limit two complementary ways:
 *
 *   1. SOURCE GUARD — the contactLimiter block in server/index.js must keep its
 *      production budget (8 requests / 15 min per IP, standard draft headers,
 *      no legacy headers) and stay mounted on /api/contact. A drive-by edit
 *      that loosens or unmounts the limiter fails this test.
 *   2. BEHAVIOUR — the exact same config, built with the SAME installed
 *      express + express-rate-limit packages the server runs (resolved via
 *      createRequire from server/), really returns 429 + the JSON message on
 *      request N+1 from one IP. This proves the config semantics (not just the
 *      literal text) on the shipped library versions.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, '..', '..', '..', 'server', 'index.js');

// Resolve express + express-rate-limit from the SERVER package (root has neither).
const requireFromServer = createRequire(path.join(__dirname, '..', '..', '..', 'server', 'index.js'));

describe('contact limiter — source guard on server/index.js', () => {
  const src = readFileSync(INDEX_PATH, 'utf8');
  const block = (src.match(/const contactLimiter = rateLimit\(\{([\s\S]*?)\}\);/) || [])[1];

  it('the contactLimiter block exists', () => {
    expect(block).toBeTruthy();
  });

  it('keeps the production budget: 8 requests / 15 minutes', () => {
    expect(block).toMatch(/windowMs:\s*15\s*\*\s*60\s*\*\s*1000/);
    expect(block).toMatch(/'production'\s*\?\s*8\s*:/);
  });

  it('uses standard draft headers and no legacy headers', () => {
    expect(block).toMatch(/standardHeaders:\s*true/);
    expect(block).toMatch(/legacyHeaders:\s*false/);
  });

  it('is mounted on the /api/contact route', () => {
    expect(src).toMatch(/app\.use\(\s*'\/api\/contact',\s*contactLimiter,\s*contactRouter\s*\)/);
  });
});

describe('contact limiter — 429 semantics at the production budget', () => {
  let server;
  afterAll(() => { try { server?.close(); } catch { /* already closed */ } });

  it('allows 8 POSTs from one IP, then 429s the 9th with the JSON message', async () => {
    const express = requireFromServer('express');
    const erl = requireFromServer('express-rate-limit');
    const rateLimit = erl.rateLimit || erl.default || erl;

    // Mirror of the contactLimiter production config in server/index.js.
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 8,
      message: { error: 'Too many messages, please try again later' },
      standardHeaders: true,
      legacyHeaders: false,
    });
    const app = express();
    app.post('/api/contact', limiter, (_req, res) => res.json({ ok: true }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;

    for (let i = 1; i <= 8; i++) {
      const r = await fetch(`${base}/api/contact`, { method: 'POST' });
      expect(r.status).toBe(200);
    }
    const ninth = await fetch(`${base}/api/contact`, { method: 'POST' });
    expect(ninth.status).toBe(429);
    const body = await ninth.json();
    expect(body).toEqual({ error: 'Too many messages, please try again later' });
    // Standard draft headers on; legacy X-RateLimit-* off.
    const names = [...ninth.headers.keys()].join(',');
    expect(names).toMatch(/ratelimit/i);
    expect(ninth.headers.get('x-ratelimit-limit')).toBeNull();
  });
});
