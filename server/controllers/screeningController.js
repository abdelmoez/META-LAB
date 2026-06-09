/**
 * screeningController.js — META·SIFT Beta API handlers.
 */
import { PrismaClient } from '@prisma/client';
import { detectDuplicatesInProject } from '../services/screeningDuplicateService.js';
import { syncConflicts } from '../services/screeningConflictService.js';
import { getProjectAccess, ensureLeaderMember, writeAudit, QUORUM } from '../screening/access.js';
import { getMetaSiftSettings } from '../screening/settings.js';
import { scorePair } from '../../src/research-engine/screening/deduplication.js';

const prisma = new PrismaClient();

// ── Ownership guard ──────────────────────────────────────────────────
async function getOwnedProject(pid, userId) {
  return prisma.screenProject.findFirst({ where: { id: pid, ownerId: userId } });
}

// ── Projects ─────────────────────────────────────────────────────────

export async function listProjects(req, res) {
  try {
    // Projects the user OWNS or is an active MEMBER of (collaboration).
    const memberships = await prisma.screenProjectMember.findMany({
      where: { userId: req.user.id, status: 'active' },
      select: { projectId: true, role: true },
    });
    const memberProjectIds = memberships.map(m => m.projectId);
    const roleByProject = Object.fromEntries(memberships.map(m => [m.projectId, m.role]));

    const projects = await prisma.screenProject.findMany({
      where: { OR: [{ ownerId: req.user.id }, { id: { in: memberProjectIds } }] },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { records: true, members: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({ projects: projects.map(p => {
      const isOwner = p.ownerId === req.user.id;
      return {
        id: p.id, title: p.title, description: p.description,
        reviewQuestion: p.reviewQuestion, stage: p.stage, blindMode: p.blindMode,
        progressStatus: p.progressStatus, archived: p.archived,
        linkedMetaLabProjectId: p.linkedMetaLabProjectId,
        recordCount: p._count.records, memberCount: p._count.members,
        owner: p.owner, isOwner,
        myRole: isOwner ? 'leader' : (roleByProject[p.id] || 'reviewer'),
        createdAt: p.createdAt, updatedAt: p.updatedAt,
      };
    })});
  } catch (err) {
    console.error('[screening] listProjects:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createProject(req, res) {
  try {
    const settings = await getMetaSiftSettings();
    if (!settings.allowNewProjects) return res.status(403).json({ error: 'New project creation is currently disabled by the administrator' });
    const { title, description = '', reviewQuestion = '', blindMode = false, linkedMetaLabProjectId } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
    const project = await prisma.screenProject.create({
      data: {
        ownerId: req.user.id,
        title: title.trim(),
        description,
        reviewQuestion,
        blindMode: !!blindMode,
        linkedMetaLabProjectId: linkedMetaLabProjectId || null,
      },
    });
    // Seed default exclusion reasons
    const defaultReasons = [
      'Wrong population', 'Wrong intervention', 'Wrong comparator',
      'Wrong outcome', 'Wrong study design', 'Duplicate', 'Not accessible',
    ];
    await prisma.screenExclusionReason.createMany({
      data: defaultReasons.map(text => ({ projectId: project.id, text })),
    });
    // The creator automatically becomes the project leader (Part 4).
    await ensureLeaderMember(project);
    res.status(201).json(project);
  } catch (err) {
    console.error('[screening] createProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getProject(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    await ensureLeaderMember(access.project);
    const p = await prisma.screenProject.findUnique({
      where: { id: access.project.id },
      include: {
        _count: { select: { records: true, members: true, conflicts: { where: { resolvedAt: null } } } },
      },
    });
    res.json({
      ...p,
      myRole: access.role,
      isLeader: access.isLeader,
      canScreen: access.canScreen,
      canChat: access.canChat,
      canResolveConflicts: access.canResolveConflicts,
    });
  } catch (err) {
    console.error('[screening] getProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateProject(req, res) {
  try {
    // Project settings are leader-only (Part 4/5).
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.isLeader) return res.status(403).json({ error: 'Only the project leader can change project settings' });
    const p = access.project;

    const {
      title, description, reviewQuestion, stage, blindMode,
      linkedMetaLabProjectId, progressStatus,
      inclusionKeywords, exclusionKeywords, studyTypeFilter, chatRestricted,
    } = req.body || {};

    const data = {};
    if (title !== undefined) data.title = String(title).trim();
    if (description !== undefined) data.description = description;
    if (reviewQuestion !== undefined) data.reviewQuestion = reviewQuestion;
    if (stage !== undefined) data.stage = stage;
    if (blindMode !== undefined) data.blindMode = !!blindMode;
    if (linkedMetaLabProjectId !== undefined) data.linkedMetaLabProjectId = linkedMetaLabProjectId || null;
    if (progressStatus !== undefined) {
      if (!['not_started', 'in_progress', 'done'].includes(progressStatus)) {
        return res.status(400).json({ error: 'invalid progressStatus' });
      }
      data.progressStatus = progressStatus;
    }
    const asJson = v => (Array.isArray(v) ? JSON.stringify(v) : v);
    if (inclusionKeywords !== undefined) data.inclusionKeywords = asJson(inclusionKeywords);
    if (exclusionKeywords !== undefined) data.exclusionKeywords = asJson(exclusionKeywords);
    if (studyTypeFilter !== undefined) data.studyTypeFilter = asJson(studyTypeFilter);
    if (chatRestricted !== undefined) data.chatRestricted = !!chatRestricted;

    const updated = await prisma.screenProject.update({ where: { id: p.id }, data });

    // Audit blind-mode changes (Part 5).
    if (blindMode !== undefined && !!blindMode !== p.blindMode) {
      await writeAudit(p.id, req.user, blindMode ? 'BLIND_MODE_ON' : 'BLIND_MODE_OFF', { entityType: 'project', entityId: p.id });
    }
    res.json(updated);
  } catch (err) {
    console.error('[screening] updateProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteProject(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    await prisma.screenProject.delete({ where: { id: p.id } });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deleteProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Records ──────────────────────────────────────────────────────────

export async function listRecords(req, res) {
  try {
    // Membership-aware: any member (or owner) may list records to screen.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;
    const me = req.user.id;
    const blind = p.blindMode && !access.isLeader;

    const page        = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit       = Math.min(200, Math.max(10, parseInt(req.query.limit || '50', 10)));
    const search      = req.query.search   || '';
    const filter      = req.query.filter || req.query.decision || 'all';
    const hasAbstract = req.query.hasAbstract;

    const where = { projectId: p.id };
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { authors: { contains: search } },
        { abstract: { contains: search } },
        { doi: { contains: search } },
        { pmid: { contains: search } },
      ];
    }

    // Pull all decisions (for reviewer indicators + quorum) and this user's open-state.
    const records = await prisma.screenRecord.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        decisions: true,
        openStates: { where: { userId: me } },
      },
    });

    const shaped = records.map((r, idx) => {
      const myDecision = r.decisions.find(d => d.reviewerId === me) || null;
      const taDecisions = r.decisions.filter(d => d.stage === 'title_abstract' && d.decision !== 'undecided');
      const includeCount = r.decisions.filter(d => d.stage === 'title_abstract' && d.decision === 'include').length;
      const distinct = new Set(taDecisions.map(d => d.decision));
      const disputed = distinct.size > 1;
      // Reviewer decision indicators (anonymised under blind mode for non-leaders).
      const reviewerDecisions = r.decisions
        .filter(d => d.decision !== 'undecided')
        .map((d, i) => ({
          reviewerId: blind ? undefined : d.reviewerId,
          reviewerName: blind ? `Reviewer ${i + 1}` : (d.reviewerName || 'Reviewer'),
          decision: d.decision,
          stage: d.stage,
          isMe: d.reviewerId === me,
        }));
      return {
        id: r.id, projectId: r.projectId,
        title: r.title, authors: blind ? '' : r.authors, year: r.year, journal: r.journal,
        doi: r.doi, pmid: r.pmid, abstract: r.abstract, keywords: r.keywords, sourceDb: r.sourceDb,
        isDuplicate: r.isDuplicate, isPrimary: r.isPrimary,
        currentStage: r.currentStage, finalStatus: r.finalStatus, promotedAt: r.promotedAt,
        myDecision,
        myOpened: r.openStates.length > 0,
        reviewerDecisions,
        includeCount,
        quorumMet: includeCount >= QUORUM || r.currentStage === 'full_text',
        disputed,
        createdAt: r.createdAt,
      };
    });

    // Filtering (the workbench left-column filter set).
    let filtered = shaped;
    const byMine = d => (r => (r.myDecision?.decision || 'undecided') === d);
    switch (filter) {
      case 'all': break;
      case 'undecided': filtered = filtered.filter(byMine('undecided')); break;
      case 'included':  filtered = filtered.filter(byMine('include')); break;
      case 'excluded':  filtered = filtered.filter(byMine('exclude')); break;
      case 'maybe':     filtered = filtered.filter(byMine('maybe')); break;
      case 'include': case 'exclude':
        filtered = filtered.filter(byMine(filter === 'include' ? 'include' : 'exclude')); break;
      case 'unopened_me': filtered = filtered.filter(r => !r.myOpened); break;
      case 'opened_me':   filtered = filtered.filter(r => r.myOpened); break;
      case 'quorum':      filtered = filtered.filter(r => r.quorumMet); break;
      case 'disputed':    filtered = filtered.filter(r => r.disputed); break;
      default: break;
    }
    if (hasAbstract === 'yes') filtered = filtered.filter(r => r.abstract && r.abstract.trim().length > 10);
    if (hasAbstract === 'no')  filtered = filtered.filter(r => !r.abstract || r.abstract.trim().length <= 10);

    const total = filtered.length;
    const start = (page - 1) * limit;
    const paged = filtered.slice(start, start + limit);

    res.json({
      records: paged,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      blindMode: p.blindMode,
      isLeader: access.isLeader,
    });
  } catch (err) {
    console.error('[screening] listRecords:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createRecord(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const { title = '', authors = '', year = '', journal = '', doi = '', pmid = '', abstract = '', keywords = '', sourceDb = '' } = req.body || {};
    const record = await prisma.screenRecord.create({
      data: { projectId: p.id, title, authors, year, journal, doi, pmid, abstract, keywords, sourceDb },
    });
    res.status(201).json(record);
  } catch (err) {
    console.error('[screening] createRecord:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteRecord(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: p.id } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    await prisma.screenRecord.delete({ where: { id: rec.id } });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deleteRecord:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Mark a record opened by the current member (per-member open-state, Part 11).
export async function markOpened(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: access.project.id } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    await prisma.screenRecordOpenState.upsert({
      where: { recordId_userId: { recordId: rec.id, userId: req.user.id } },
      update: { openedAt: new Date() },
      create: { recordId: rec.id, projectId: access.project.id, userId: req.user.id },
    });
    res.json({ opened: true });
  } catch (err) {
    console.error('[screening] markOpened:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Import ──────────────────────────────────────────────────────────

export async function importRecords(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });

    const settings = await getMetaSiftSettings();
    if (!settings.allowImport) return res.status(403).json({ error: 'Import is currently disabled by the administrator' });

    const { format = 'ris', content = '', filename = 'import' } = req.body || {};
    if (!content.trim()) return res.status(400).json({ error: 'content is required' });

    // Parse references using existing engine parsers
    let records = [];
    try {
      const { detectAndParse } = await import('../../src/research-engine/import-export/parsers.js');
      const parsed = detectAndParse(content, format);
      records = parsed.records || parsed || [];
    } catch (parseErr) {
      // Fallback: try basic RIS split
      records = fallbackParseRIS(content);
    }

    if (!records.length) return res.status(400).json({ error: 'No records found in the provided content' });
    if (records.length > 5000) return res.status(400).json({ error: 'Import limit: 5000 records per batch' });
    const maxRecords = settings.maxRecordsPerProject || 10000;
    const existingCount = await prisma.screenRecord.count({ where: { projectId: p.id } });
    if (existingCount + records.length > maxRecords) {
      return res.status(400).json({ error: `Import would exceed the project limit of ${maxRecords} records (currently ${existingCount})` });
    }

    // Create import batch
    const batch = await prisma.screenImportBatch.create({
      data: { projectId: p.id, filename, format, recordCount: records.length },
    });

    // Create records in chunks to avoid SQLite limits
    const CHUNK = 100;
    let imported = 0;
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      await prisma.screenRecord.createMany({
        data: chunk.map(r => ({
          projectId:    p.id,
          importBatchId: batch.id,
          title:        String(r.title || '').slice(0, 1000),
          authors:      Array.isArray(r.authors) ? r.authors.join('; ').slice(0, 500) : String(r.authors || '').slice(0, 500),
          year:         String(r.year || ''),
          journal:      String(r.journal || r.source || '').slice(0, 300),
          doi:          String(r.doi || '').slice(0, 200),
          pmid:         String(r.pmid || '').slice(0, 50),
          abstract:     String(r.abstract || '').slice(0, 5000),
          keywords:     Array.isArray(r.keywords) ? r.keywords.join('; ') : String(r.keywords || ''),
          sourceDb:     String(r.sourceDb || r.source || format).slice(0, 100),
          rawData:      JSON.stringify(r).slice(0, 2000),
        })),
      });
      imported += chunk.length;
    }

    // Update batch count
    await prisma.screenImportBatch.update({ where: { id: batch.id }, data: { recordCount: imported } });

    res.json({ imported, total: imported, batchId: batch.id });
  } catch (err) {
    console.error('[screening] importRecords:', err.message);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
}

function fallbackParseRIS(content) {
  const entries = content.split(/\nER\s*-?\s*\n/i).filter(e => e.trim());
  return entries.map(entry => {
    const get = (tag) => {
      const m = entry.match(new RegExp(`^${tag}\\s+-\\s+(.+)`, 'm'));
      return m ? m[1].trim() : '';
    };
    return {
      title:    get('TI') || get('T1') || get('TY'),
      authors:  get('AU') || get('A1'),
      year:     get('PY') || get('Y1'),
      journal:  get('JO') || get('JF') || get('T2'),
      doi:      get('DO') || get('M3'),
      pmid:     get('AN'),
      abstract: get('AB') || get('N2'),
    };
  }).filter(r => r.title);
}

// ── Export ───────────────────────────────────────────────────────────

export async function exportRecords(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });

    const settings = await getMetaSiftSettings();
    if (!settings.allowExport) return res.status(403).json({ error: 'Export is currently disabled by the administrator' });

    const fmt    = req.query.format || 'csv';
    const filter = req.query.filter || 'all';

    const records = await prisma.screenRecord.findMany({
      where: { projectId: p.id },
      include: { decisions: true },
    });

    // Build export rows
    const rows = records.map(r => {
      const myDec = r.decisions.find(d => d.reviewerId === req.user.id);
      return {
        id:             r.id,
        title:          r.title,
        authors:        r.authors,
        year:           r.year,
        journal:        r.journal,
        doi:            r.doi,
        pmid:           r.pmid,
        abstract:       r.abstract,
        decision:       myDec?.decision || 'undecided',
        exclusionReason: myDec?.exclusionReason || '',
        notes:          myDec?.notes || '',
        rating:         myDec?.rating ?? '',
        labels:         myDec?.labels || '[]',
        isDuplicate:    r.isDuplicate,
        sourceDb:       r.sourceDb,
      };
    });

    // Apply filter
    const filtered = filter === 'all' ? rows : rows.filter(r => r.decision === filter);

    if (fmt === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="sift-export-${p.id.slice(0,8)}.json"`);
      return res.json(filtered);
    }

    // CSV
    const cols = ['title','authors','year','journal','doi','pmid','decision','exclusionReason','notes','rating','isDuplicate','abstract'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...filtered.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sift-export-${p.id.slice(0,8)}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[screening] exportRecords:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
}

// ── Decisions ────────────────────────────────────────────────────────

export async function saveDecision(req, res) {
  try {
    // Membership-aware: owner OR an active member with screening permission.
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canScreen) {
      return res.status(403).json({ error: 'You do not have permission to screen in this project' });
    }
    const p = access.project;

    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: p.id } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });

    const { decision = 'undecided', exclusionReason = '', notes = '', rating, labels = '[]', stage: bodyStage } = req.body || {};
    const validDecisions = ['include', 'exclude', 'maybe', 'undecided'];
    if (!validDecisions.includes(decision)) return res.status(400).json({ error: 'Invalid decision value' });

    // A decision belongs to the record's current review stage unless the
    // caller explicitly targets one (used by the Second Review screen).
    const stage = (bodyStage === 'full_text' || bodyStage === 'title_abstract')
      ? bodyStage
      : (rec.currentStage || 'title_abstract');
    const reviewerName = access.member?.name || req.user.email || '';

    // One active decision per reviewer per record per stage (schema-enforced).
    const d = await prisma.screenDecision.upsert({
      where: { recordId_reviewerId_stage: { recordId: rec.id, reviewerId: req.user.id, stage } },
      update: {
        decision, exclusionReason, notes, reviewerName,
        rating: rating != null ? parseInt(rating) : null,
        labels: Array.isArray(labels) ? JSON.stringify(labels) : labels,
      },
      create: {
        recordId: rec.id, projectId: p.id, reviewerId: req.user.id, reviewerName, stage,
        decision, exclusionReason, notes,
        rating: rating != null ? parseInt(rating) : null,
        labels: Array.isArray(labels) ? JSON.stringify(labels) : labels,
      },
    });

    // Quorum (Part 2/3): when >= QUORUM distinct reviewers INCLUDE a record at
    // the title/abstract stage, it becomes eligible for Second Review (full_text).
    let promoted = false;
    if (stage === 'title_abstract' && rec.currentStage === 'title_abstract') {
      const includeCount = await prisma.screenDecision.count({
        where: { recordId: rec.id, stage: 'title_abstract', decision: 'include' },
      });
      if (includeCount >= QUORUM) {
        await prisma.screenRecord.update({
          where: { id: rec.id },
          data: { currentStage: 'full_text', promotedAt: new Date() },
        });
        promoted = true;
      }
    }

    // Sync conflicts for this record (non-blocking)
    syncConflicts(p.id, rec.id).catch(() => {});

    res.json({ ...d, promoted });
  } catch (err) {
    console.error('[screening] saveDecision:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function listDecisions(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const decisions = await prisma.screenDecision.findMany({
      where: { projectId: p.id, reviewerId: req.user.id },
    });
    res.json({ decisions });
  } catch (err) {
    console.error('[screening] listDecisions:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Conflicts ────────────────────────────────────────────────────────

export async function listConflicts(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const conflicts = await prisma.screenConflict.findMany({
      where: { projectId: p.id },
      include: { record: { select: { id: true, title: true, authors: true, year: true, abstract: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ conflicts });
  } catch (err) {
    console.error('[screening] listConflicts:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function resolveConflict(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const settings = await getMetaSiftSettings();
    if (!settings.allowConflictResolution) return res.status(403).json({ error: 'Conflict resolution is currently disabled by the administrator' });
    const conflict = await prisma.screenConflict.findFirst({ where: { id: req.params.cid, projectId: p.id } });
    if (!conflict) return res.status(404).json({ error: 'Conflict not found' });
    const { finalDecision, notes = '' } = req.body || {};
    if (!finalDecision) return res.status(400).json({ error: 'finalDecision is required' });
    const updated = await prisma.screenConflict.update({
      where: { id: conflict.id },
      data: { finalDecision, resolvedBy: req.user.id, resolvedAt: new Date(), notes },
    });
    res.json(updated);
  } catch (err) {
    console.error('[screening] resolveConflict:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Duplicates ───────────────────────────────────────────────────────

export async function listDuplicates(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const groups = await prisma.screenDuplicateGroup.findMany({
      where: { projectId: access.project.id },
      include: { records: { select: {
        id: true, title: true, authors: true, year: true, journal: true,
        doi: true, pmid: true, sourceDb: true, abstract: true, isPrimary: true, isDuplicate: true,
      } } },
      orderBy: { createdAt: 'desc' },
    });
    // Surface an explainable similarity % per group (max pairwise score).
    const scored = groups.map(g => {
      let best = { score: 0, reason: '' };
      const recs = g.records || [];
      for (let i = 0; i < recs.length; i++) {
        for (let j = i + 1; j < recs.length; j++) {
          const s = scorePair(recs[i], recs[j]);
          if (s.score >= best.score) best = s;
        }
      }
      return { ...g, similarity: best.score, similarityReason: best.reason, resolved: !!g.resolvedAt };
    });
    res.json({ groups: scored, isLeader: access.isLeader });
  } catch (err) {
    console.error('[screening] listDuplicates:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function detectDuplicates(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const settings = await getMetaSiftSettings();
    if (!settings.allowDuplicateDetection) return res.status(403).json({ error: 'Duplicate detection is currently disabled by the administrator' });
    const result = await detectDuplicatesInProject(p.id, prisma);
    res.json(result);
  } catch (err) {
    console.error('[screening] detectDuplicates:', err.message);
    res.status(500).json({ error: 'Detection failed: ' + err.message });
  }
}

export async function resolveDuplicateGroup(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const group = await prisma.screenDuplicateGroup.findFirst({ where: { id: req.params.gid, projectId: p.id } });
    if (!group) return res.status(404).json({ error: 'Duplicate group not found' });
    const { primaryId } = req.body || {};
    if (!primaryId) return res.status(400).json({ error: 'primaryId is required' });

    // Mark all in group as duplicate, except primary
    await prisma.screenRecord.updateMany({ where: { duplicateGroupId: group.id }, data: { isDuplicate: true, isPrimary: false } });
    await prisma.screenRecord.update({ where: { id: primaryId }, data: { isDuplicate: false, isPrimary: true } });
    await prisma.screenDuplicateGroup.update({ where: { id: group.id }, data: { resolvedAt: new Date(), primaryId } });

    res.json({ resolved: true, primaryId });
  } catch (err) {
    console.error('[screening] resolveDuplicateGroup:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Labels ────────────────────────────────────────────────────────────

export async function listLabels(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;
    const labels = await prisma.screenLabel.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
    res.json({ labels });
  } catch (err) {
    console.error('[screening] listLabels:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createLabel(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const { name, color = '#5b9cf6' } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const label = await prisma.screenLabel.create({ data: { projectId: p.id, name: name.trim(), color } });
    res.status(201).json(label);
  } catch (err) {
    console.error('[screening] createLabel:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteLabel(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const label = await prisma.screenLabel.findFirst({ where: { id: req.params.lid, projectId: p.id } });
    if (!label) return res.status(404).json({ error: 'Label not found' });
    await prisma.screenLabel.delete({ where: { id: label.id } });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deleteLabel:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Exclusion reasons ────────────────────────────────────────────────

export async function listReasons(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;
    const reasons = await prisma.screenExclusionReason.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
    res.json({ reasons });
  } catch (err) {
    console.error('[screening] listReasons:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createReason(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
    const reason = await prisma.screenExclusionReason.create({ data: { projectId: p.id, text: text.trim() } });
    res.status(201).json(reason);
  } catch (err) {
    console.error('[screening] createReason:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteReason(req, res) {
  try {
    const p = await getOwnedProject(req.params.pid, req.user.id);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const reason = await prisma.screenExclusionReason.findFirst({ where: { id: req.params.rid2, projectId: p.id } });
    if (!reason) return res.status(404).json({ error: 'Reason not found' });
    await prisma.screenExclusionReason.delete({ where: { id: reason.id } });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deleteReason:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Stats ─────────────────────────────────────────────────────────────

export async function getStats(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const p = access.project;

    const [total, myDecisions, conflicts, duplicates] = await Promise.all([
      prisma.screenRecord.count({ where: { projectId: p.id } }),
      prisma.screenDecision.findMany({ where: { projectId: p.id, reviewerId: req.user.id } }),
      prisma.screenConflict.count({ where: { projectId: p.id, resolvedAt: null } }),
      prisma.screenRecord.count({ where: { projectId: p.id, isDuplicate: true } }),
    ]);

    const counts = { include: 0, exclude: 0, maybe: 0, undecided: 0 };
    myDecisions.forEach(d => { if (counts[d.decision] !== undefined) counts[d.decision]++; });
    const screened = counts.include + counts.exclude + counts.maybe;
    counts.undecided = total - screened;

    res.json({
      total, screened,
      included: counts.include,
      excluded: counts.exclude,
      maybe: counts.maybe,
      undecided: counts.undecided,
      conflicts,
      duplicates,
      progress: total > 0 ? Math.round((screened / total) * 100) : 0,
    });
  } catch (err) {
    console.error('[screening] getStats:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── META·LAB integration: PRISMA summary for a linked META·LAB project ──
// GET /metalab/:mlpid/summary — returns screening-derived PRISMA flow numbers
// for the META·SIFT project linked to the given META·LAB project (owned by the
// caller). Used by the monolith to auto-update its PRISMA diagram (Part 12).
export async function getMetaLabSummary(req, res) {
  try {
    const sp = await prisma.screenProject.findFirst({
      where: { linkedMetaLabProjectId: req.params.mlpid, ownerId: req.user.id },
    });
    if (!sp) return res.json({ linked: false });

    const records = await prisma.screenRecord.findMany({
      where: { projectId: sp.id },
      select: { isDuplicate: true, currentStage: true, finalStatus: true },
    });
    const total              = records.length;
    const duplicatesRemoved  = records.filter(r => r.isDuplicate).length;
    const screened           = Math.max(0, total - duplicatesRemoved);
    const fullTextAssessed   = records.filter(r => r.currentStage === 'full_text').length;
    const excludedTitleAbstract = Math.max(0, screened - fullTextAssessed);
    const fullTextExcluded   = records.filter(r => r.finalStatus === 'rejected').length;
    const includedFinal      = records.filter(r => r.finalStatus === 'accepted').length;

    res.json({
      linked: true,
      screeningProjectId: sp.id,
      title: sp.title,
      prisma: { identified: total, duplicatesRemoved, screened, excludedTitleAbstract, fullTextAssessed, fullTextExcluded, included: includedFinal },
    });
  } catch (err) {
    console.error('[screening] getMetaLabSummary:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
