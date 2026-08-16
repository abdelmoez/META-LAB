/**
 * 119.md §5 / §10 "Schema and migration tests" — the ManuscriptFigure table.
 *
 * Pins it in BOTH schema files (dev SQLite + prod Postgres mirror), the §5 data
 * model, the indexes the Figures panel and the dedupe path actually query, and
 * the repo's additive `db push` discipline (every column defaulted or nullable,
 * so pushing onto a live database can never need --accept-data-loss).
 */
import { describe, it, expect } from 'vitest';
import { readSource } from '../../helpers/readSource.js';

const sqlite = readSource(new URL('../../../server/prisma/schema.prisma', import.meta.url));
const postgres = readSource(new URL('../../../server/prisma/postgres/schema.prisma', import.meta.url));

const modelBody = (schema, name) => {
  const start = schema.indexOf(`model ${name} {`);
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n}', start) + 2);
};

const SQLITE = modelBody(sqlite, 'ManuscriptFigure');
const POSTGRES = modelBody(postgres, 'ManuscriptFigure');

/** Every §5 "Figure data model" bullet that belongs to the FILE → its column. */
const REQUIRED_FIELDS = {
  'Stable internal ID independent of the displayed number': ['id', 'figKey'],
  'Original filename and file type': ['fileName', 'mimeType'],
  'Dimensions and resolution where available': ['width', 'height'],
  'Alt text': ['altText'],
  'Source/provenance': ['sourceNote'],
  'System-generated versus user-uploaded status': ['origin'],
  'Creator or uploader + upload date': ['uploadedBy', 'uploadedByName', 'createdAt'],
  'Version/replacement history': ['replacedCount', 'prevStoredName', 'prevFileName', 'prevFileHash', 'replacedAt'],
  'Content identity (dedupe + ETag)': ['fileHash', 'fileSize', 'storedName'],
  'Project isolation': ['projectId'],
};

describe('ManuscriptFigure — schema', () => {
  it('exists in BOTH the SQLite source of truth and the Postgres mirror', () => {
    expect(SQLITE.length).toBeGreaterThan(0);
    expect(POSTGRES.length).toBeGreaterThan(0);
  });

  it('the Postgres mirror is byte-identical to the canonical model body', () => {
    expect(POSTGRES).toBe(SQLITE);
  });

  for (const [bullet, fields] of Object.entries(REQUIRED_FIELDS)) {
    it(`carries the §5 field(s) for "${bullet}"`, () => {
      for (const f of fields) expect(SQLITE).toMatch(new RegExp(`^\\s+${f}\\s`, 'm'));
    });
  }

  it('one figure key per project, and the query shapes the feature issues', () => {
    expect(SQLITE).toContain('@@unique([projectId, figKey])');
    expect(SQLITE).toContain('@@index([projectId, createdAt])');
    expect(SQLITE).toContain('@@index([projectId, fileHash])');   // content dedupe
  });

  it('is `db push`-safe: a BRAND-NEW table with no FK to an existing one', () => {
    // House rule (see the ScreenPdfAttachment / PdfAnnotation precedents): bare
    // scope keys, no `@relation`, so pushing this table can neither rewrite nor
    // cascade into anything that already holds data, and the @@unique is legal
    // because it is unique by construction on an empty table.
    expect(SQLITE).not.toContain('@relation');
    expect(SQLITE).toContain('projectId     String');
    // The OPTIONAL §5 fields (the ones a legacy row would not have) are all
    // defaulted or nullable, so a later additive push stays safe too.
    for (const col of ['fileSize', 'mimeType', 'width', 'height', 'altText', 'sourceNote', 'origin', 'uploadedByName', 'replacedCount']) {
      expect(SQLITE).toMatch(new RegExp(`^\\s+${col}\\s+\\w+\\s+@default\\(`, 'm'));
    }
    for (const col of ['prevStoredName', 'prevFileName', 'prevFileHash', 'replacedAt']) {
      expect(SQLITE).toMatch(new RegExp(`^\\s+${col}\\s+\\w+\\?`, 'm'));
    }
  });

  it('the binaries live on disk — the blob carries no image bytes', () => {
    // The whole reason this table exists (see its schema comment): Project.data is
    // re-sent in full on every autosave under a 10 MB parser ceiling.
    expect(SQLITE).toContain('storedName');
    expect(SQLITE).not.toMatch(/^\s+data\s+(String|Bytes)/m);
  });
});
