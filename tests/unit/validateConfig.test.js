/**
 * validateConfig.test.js — startup config diagnostics (prompt49 §10). Pure.
 */
import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../server/config/validateConfig.js';

const goodProd = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  DATABASE_URL: 'postgresql://u:p@h:5432/db',
  CORS_ORIGIN: 'https://pecanrev.com',
  APP_BASE_URL: 'https://pecanrev.com',
  SMTP_HOST: 'smtp.example.com',
  EMAIL_FROM: 'PecanRev <no-reply@pecanrev.com>',
};

describe('validateConfig — production', () => {
  it('passes with a complete, secure production config', () => {
    const r = validateConfig({ env: goodProd });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('fails when JWT_SECRET is missing or too short', () => {
    expect(validateConfig({ env: { ...goodProd, JWT_SECRET: '' } }).ok).toBe(false);
    expect(validateConfig({ env: { ...goodProd, JWT_SECRET: 'short' } }).ok).toBe(false);
  });

  it('fails on a placeholder JWT_SECRET in production', () => {
    const r = validateConfig({ env: { ...goodProd, JWT_SECRET: 'change-me-to-a-long-random-hex-string' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/placeholder/i);
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(validateConfig({ env: { ...goodProd, DATABASE_URL: '' } }).ok).toBe(false);
  });

  it('fails on a wildcard CORS origin (credentialed cookies)', () => {
    const r = validateConfig({ env: { ...goodProd, CORS_ORIGIN: '*' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/wildcard/i);
  });

  it('requires an explicit origin in production', () => {
    const r = validateConfig({ env: { ...goodProd, CORS_ORIGIN: '', APP_BASE_URL: '' } });
    expect(r.ok).toBe(false);
  });

  it('warns (not errors) on http APP_BASE_URL in production', () => {
    const r = validateConfig({ env: { ...goodProd, APP_BASE_URL: 'http://pecanrev.com', CORS_ORIGIN: 'https://pecanrev.com' } });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Secure cookies/i);
  });
});

describe('validateConfig — database provider (prompt49 item 2)', () => {
  it('passes with sqlite (default) and no postgres URL', () => {
    expect(validateConfig({ env: { ...goodProd, DATABASE_PROVIDER: 'sqlite' } }).ok).toBe(true);
    expect(validateConfig({ env: goodProd }).ok).toBe(true); // unset = sqlite
  });

  it('fails in production when DATABASE_PROVIDER=postgres but POSTGRES_DATABASE_URL is missing', () => {
    const r = validateConfig({ env: { ...goodProd, DATABASE_PROVIDER: 'postgres' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/POSTGRES_DATABASE_URL/);
  });

  it('passes when postgres provider has its URL', () => {
    const r = validateConfig({ env: { ...goodProd, DATABASE_PROVIDER: 'postgresql', POSTGRES_DATABASE_URL: 'postgresql://u:p@h:5432/pg' } });
    expect(r.ok).toBe(true);
  });

  it('warns on an unrecognised provider', () => {
    const r = validateConfig({ env: { ...goodProd, DATABASE_PROVIDER: 'mysql' } });
    expect(r.warnings.join(' ')).toMatch(/not recognised/i);
  });
});

describe('validateConfig — development', () => {
  it('never fails in dev, only warns', () => {
    const r = validateConfig({ env: { NODE_ENV: 'development' } });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0); // missing JWT_SECRET/DATABASE_URL → warnings
  });
});

describe('validateConfig — email', () => {
  it('warns when email is half-configured', () => {
    const r = validateConfig({ env: { ...goodProd, EMAIL_FROM: '' } });
    expect(r.warnings.join(' ')).toMatch(/partially configured/i);
  });
});
