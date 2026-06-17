/**
 * geo.test.js — prompt30 Part 1. IP → country resolution: hardened client-IP
 * extraction, private/local fallback (never the literal "Local"), and proxy
 * country headers. resolveCountry must NEVER throw.
 */
import { describe, it, expect } from 'vitest';
import { getClientIp, isPrivateIp, resolveCountry, countryNameFromCode } from '../../server/utils/geo.js';

describe('isPrivateIp', () => {
  it('flags loopback / RFC1918 / IPv6 local + empty', () => {
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.0.5', '172.16.9.9', '172.31.0.1', 'localhost', '', '::ffff:127.0.0.1', 'fe80::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it('does not flag public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.7', '172.32.0.1']) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe('getClientIp', () => {
  it('uses a trusted public req.ip (trust proxy resolved it)', () => {
    expect(getClientIp({ ip: '203.0.113.9', headers: {} })).toBe('203.0.113.9');
  });
  it('falls back to the first PUBLIC hop of x-forwarded-for when req.ip is private', () => {
    const req = { ip: '10.0.0.1', headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.5, 70.1.1.1' } };
    expect(getClientIp(req)).toBe('203.0.113.5');
  });
  it('keeps a genuine private/local IP when no public hop exists (dev)', () => {
    expect(getClientIp({ ip: '127.0.0.1', headers: {} })).toBe('127.0.0.1');
  });
  it('returns "" for a missing request', () => {
    expect(getClientIp(null)).toBe('');
  });
});

describe('countryNameFromCode', () => {
  it('maps ISO alpha-2 to a name', () => {
    expect(countryNameFromCode('US')).toMatch(/United States/);
    expect(countryNameFromCode('')).toBe('');
  });
});

describe('resolveCountry', () => {
  it('uses a proxy country header when present', async () => {
    const r = await resolveCountry({ headers: { 'cf-ipcountry': 'FR' }, ip: '10.0.0.1' });
    expect(r.code).toBe('FR');
    expect(r.source).toBe('header');
    expect(r.name).toMatch(/France/);
  });
  it('ignores Cloudflare placeholder codes', async () => {
    const r = await resolveCountry({ headers: { 'cf-ipcountry': 'XX' }, ip: '127.0.0.1' });
    expect(r.source).toBe('local'); // falls through to private-IP branch
  });
  it('private/local IP → empty name (NOT "Local"), source local', async () => {
    const r = await resolveCountry({ headers: {}, ip: '127.0.0.1' });
    expect(r.name).toBe('');          // persisted as "Unknown" by the caller
    expect(r.name).not.toBe('Local');
    expect(r.code).toBe('');
    expect(r.source).toBe('local');
  });
  it('public IP with no header/geoip → Unknown, never throws', async () => {
    const r = await resolveCountry({ headers: {}, ip: '203.0.113.42' });
    expect(['none', 'geoip']).toContain(r.source); // geoip only if the optional pkg is installed
    expect(r.name).toBeTruthy();
  });
  it('never throws on a garbage request', async () => {
    await expect(resolveCountry(null)).resolves.toBeTruthy();
    await expect(resolveCountry({})).resolves.toBeTruthy();
  });
});
