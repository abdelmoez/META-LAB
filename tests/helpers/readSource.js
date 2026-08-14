/**
 * tests/helpers/readSource.js — 116.md validation.
 *
 * Several suites pin CLIENT WIRING by asserting on the source text itself
 * (`src.indexOf("e.preventDefault();\n    const el = …")`), because the behaviour
 * they guard — ordering inside an event handler, a hook's dependency list, which
 * write path an executor calls — is not observable through `renderToStaticMarkup`
 * and this repo has no jsdom. That technique is deliberate and stays.
 *
 * Its one sharp edge is the line ending. The patterns are written with `\n`, but
 * on Windows any `git checkout`, `git stash pop` or branch round-trip can
 * materialise the file with CRLF under `core.autocrlf=true`. The assertion then
 * fails on a file nobody edited, and the failure points at the component rather
 * than at the checkout — it cost two separate debugging passes during the 116.md
 * validation alone.
 *
 * Reading through here normalises CRLF (and a stray BOM) so the pins compare
 * source CONTENT, never the checkout's line-ending policy. Offsets shift by one
 * byte per preceding line versus the raw file, which is irrelevant to every
 * existing assertion (all are `indexOf`/`includes`/`match`, none report an
 * absolute file offset to a human).
 */
import { readFileSync } from 'node:fs';

/** Read a source file as text with LF line endings and no BOM. */
export function readSource(target) {
  return readFileSync(target, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

export default readSource;
