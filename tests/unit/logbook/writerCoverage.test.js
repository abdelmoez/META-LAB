/**
 * 119.md §8 / §10 scenario 20 — "Verifying audit completeness for representative
 * actions in every engine."
 *
 * The Logbook's writer calls are SURGICAL insertions inside engines that own
 * their own control flow (a membership transaction, a search worker's terminal
 * transition, the autosave path). Exercising each of those handlers end-to-end
 * would mean rebuilding a dozen module graphs per assertion; what actually needs
 * guarding is that the call site EXISTS, is wired to the right writer, and names
 * a registered action. So this suite pins the WIRING at the source level (the
 * readSource precedent used elsewhere in the repo for exactly this class of
 * assertion) and cross-checks every pinned action against the vocabulary, so a
 * refactor that drops a call site or invents an unregistered action fails here.
 *
 * Behavioural coverage of what those calls DO lives in service.test.js
 * (transactional vs best-effort vs coalesced) and authz.test.js (the API layer).
 */
import { describe, it, expect } from 'vitest';
import { readSource } from '../../helpers/readSource.js';
import { LOG_ACTION_KEYS, MIRRORED_SCREEN_AUDIT_ACTIONS } from '../../../server/logbook/vocabulary.js';

const S = (p) => readSource(new URL(`../../../${p}`, import.meta.url));

/**
 * One row per §8 engine: the file that must carry the writer, the writer it must
 * import, and the actions it must emit.
 *
 * `transactional: true` means the CRITICAL-write rule applies — the row must go
 * through withLoggedTransaction / recordLogEventTx so a successful mutation can
 * never silently lose its audit record (§8's closing paragraph).
 */
const COVERAGE = [
  {
    engine: 'core / membership',
    file: 'server/controllers/screeningMemberController.js',
    writers: ['withLoggedTransaction', 'recordLogEventTx'],
    transactional: true,
    actions: ['MEMBER_ADDED', 'MEMBER_PERMISSIONS_CHANGED', 'MEMBER_REMOVED', 'MEMBER_LEFT', 'INVITE_REVOKED', 'OWNERSHIP_TRANSFERRED'],
  },
  {
    engine: 'core / project lifecycle',
    file: 'server/controllers/screeningController.js',
    writers: ['recordLogEvent', 'recordLogEventTx', 'withLoggedTransaction'],
    transactional: true,
    actions: ['PROJECT_CREATED', 'PROJECT_SETTINGS_CHANGED', 'PROJECT_ARCHIVED', 'PROJECT_RESTORED', 'PROJECT_DELETED'],
  },
  {
    engine: 'search',
    file: 'server/pecanSearch/runService.js',
    writers: ['recordLogEvent'],
    transactional: false,
    actions: ['SEARCH_RUN_STARTED', 'SEARCH_RUN_COMPLETED', 'SEARCH_RUN_FAILED', 'SEARCH_RUN_CANCELLED'],
  },
  {
    engine: 'analysis',
    file: 'server/controllers/nmaController.js',
    writers: ['recordLogEvent'],
    transactional: false,
    actions: ['ANALYSIS_RUN', 'ANALYSIS_RUN_FAILED'],
  },
  {
    engine: 'manuscript',
    file: 'server/logbook/manuscriptSession.js',
    writers: ['recordSessionEvent'],
    transactional: false,
    actions: ['MANUSCRIPT_EDIT_SESSION'],
  },
  {
    engine: 'exports',
    file: 'server/controllers/importExportController.js',
    writers: ['recordLogEvent'],
    transactional: false,
    actions: ['EXPORT_GENERATED', 'EXPORT_FAILED'],
  },
  {
    engine: 'files',
    file: 'server/controllers/screeningPdfController.js',
    writers: ['recordSessionEvent'],
    transactional: false,
    actions: ['FILE_DOWNLOADED'],
  },
  {
    engine: 'logbook security',
    file: 'server/controllers/logbookController.js',
    writers: ['recordLogEvent', 'recordSessionEvent'],
    transactional: false,
    actions: ['LOGBOOK_VIEWED', 'LOGBOOK_EXPORTED', 'LOGBOOK_ACCESS_DENIED'],
  },
];

describe('§8 writer coverage — every engine emits its events', () => {
  for (const row of COVERAGE) {
    describe(row.engine, () => {
      const src = S(row.file);

      it('imports the Logbook writer from the single writer service', () => {
        expect(src).toMatch(/from '[^']*logbookService\.js'/);
        expect(row.writers.some((w) => src.includes(w))).toBe(true);
      });

      it('cites the prompt section at the insertion point', () => {
        expect(src).toContain('119.md §8');
      });

      // The action may be a literal (`action: 'X'`) or selected by a ternary
      // (`removeMember` picks INVITE_REVOKED vs MEMBER_REMOVED; the search worker
      // picks its terminal action from the run state), so the pin is on the
      // string literal being present, not on one particular syntax.
      it.each(row.actions)('emits %s', (action) => {
        expect(src).toContain(`'${action}'`);
      });

      it('emits only REGISTERED actions', () => {
        for (const action of row.actions) expect(LOG_ACTION_KEYS).toContain(action);
      });

      if (row.transactional) {
        it('uses the TRANSACTIONAL writer for its critical mutations', () => {
          expect(/withLoggedTransaction|recordLogEventTx/.test(src)).toBe(true);
        });
      }
    });
  }

  it('nothing outside server/logbook/** writes to ProjectLogEvent directly', () => {
    // The single-writer rule: engines call the service, never prisma.projectLogEvent.
    for (const row of COVERAGE) {
      if (row.file.startsWith('server/logbook/')) continue;
      expect(S(row.file)).not.toContain('projectLogEvent');
    }
  });

  it('every mirrored membership/lifecycle write stamps the `mirrors` marker', () => {
    // Without it, logbookQuery.cutoverAt cannot retire the legacy twin and the
    // change would appear twice in the merged timeline.
    const member = S('server/controllers/screeningMemberController.js');
    const project = S('server/controllers/screeningController.js');
    const mirrorCount = (member.match(/mirrors: MIRROR_SCREEN_AUDIT/g) || []).length
      + (project.match(/mirrors: MIRROR_SCREEN_AUDIT/g) || []).length;
    // One per mirrored family: add / permissions / remove+revoke / left / transfer
    // on the member side, archive / restore / delete on the project side.
    expect(mirrorCount).toBeGreaterThanOrEqual(MIRRORED_SCREEN_AUDIT_ACTIONS.length - 2);
  });

  it('the legacy writeAudit calls are PRESERVED (the screening audit view still works)', () => {
    // Forward-only bridging: the Logbook does NOT replace ScreenAuditLog, so the
    // existing leader-only /screening/audit endpoint and its UI keep working.
    const member = S('server/controllers/screeningMemberController.js');
    for (const a of ['MEMBER_ADDED', 'MEMBER_PERMISSIONS_CHANGED', 'MEMBER_REMOVED', 'MEMBER_LEFT', 'INVITE_REVOKED']) {
      expect(member).toMatch(new RegExp(`writeAudit\\(req\\.params\\.pid, req\\.user, '${a}'`));
    }
    expect(member).toMatch(/writeAudit\(pid, req\.user, 'OWNERSHIP_TRANSFERRED'/);
    const project = S('server/controllers/screeningController.js');
    for (const a of ['PROJECT_DELETED', 'PROJECT_ARCHIVED', 'PROJECT_UNARCHIVED']) {
      expect(project).toMatch(new RegExp(`writeAudit\\(p\\.id, req\\.user, '${a}'`));
    }
  });

  it('the autosave path captures manuscript sessions without blocking the save', () => {
    const store = S('server/store.js');
    expect(store).toContain('captureLogbookSession');
    expect(store).toContain('manuscriptSession.js');
    // Fire-and-forget: no `await` on the capture inside save().
    expect(store).not.toMatch(/await\s+captureLogbookSession/);
  });

  it('the route mount enforces auth before the leader guard', () => {
    const index = S('server/index.js');
    expect(index).toContain("app.use('/api/logbook', requireAuth, logbookLimiter, logbookRouter);");
    const routes = S('server/routes/logbook.js');
    // Every declared route carries the guard.
    const declared = routes.match(/^router\.get\(.*$/gm) || [];
    expect(declared.length).toBeGreaterThan(0);
    for (const line of declared) expect(line).toContain('requireProjectLeader');
    // Read-only by construction — no write verbs on the Logbook router.
    expect(routes).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });
});
