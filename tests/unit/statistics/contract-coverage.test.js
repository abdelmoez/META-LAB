/**
 * contract-coverage.test.js — guard test (roadmap 0.1).
 *
 * Fails if any export from statistics/** is not documented in agent-contract.md.
 * This keeps the binding API contract (src/research-engine/docs/agent-contract.md)
 * in sync with the code: adding a new estimator without documenting it breaks CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as metaMod from '../../../src/research-engine/statistics/meta-analysis.js';
import * as mathMod from '../../../src/research-engine/statistics/math-helpers.js';

const contract = readFileSync(
  fileURLToPath(new URL('../../../src/research-engine/docs/agent-contract.md', import.meta.url)),
  'utf8',
);

function exportNames(mod) {
  return Object.keys(mod).filter(k => k !== 'default');
}

describe('agent-contract.md covers every statistics/** export', () => {
  it('documents each meta-analysis.js export', () => {
    const missing = exportNames(metaMod).filter(name => !contract.includes('`' + name + '`'));
    expect(missing, `Undocumented exports in agent-contract.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents each math-helpers.js export', () => {
    const missing = exportNames(mathMod).filter(name => !contract.includes('`' + name + '`'));
    expect(missing, `Undocumented exports in agent-contract.md: ${missing.join(', ')}`).toEqual([]);
  });
});
