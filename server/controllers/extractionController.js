/**
 * extractionController.js — HTTP layer for structured data extraction (66.md P5,
 * flag `extractionAssist`, default OFF → all routes 404).
 *
 * Design invariants (66.md non-negotiables):
 *  - AI suggestions NEVER auto-commit: they live in AiExtractionSuggestion and
 *    only become ExtractionValue rows when a human accepts/edits them.
 *  - Extractor values are NEVER overwritten by adjudication — consensus lives in
 *    its own table with full attribution.
 *  - Dual extraction is blinded: an extractor cannot read the other extractor's
 *    values; only adjudicators (owner/leader/canManageExtraction) see both sides.
 *  - Send-to-MA writes blob study fields with provenance and never silently
 *    overwrites human-entered effect sizes (409 unless overwrite confirmed).
 */
import { prisma } from '../db/client.js';
import { emitToMetaLabProject } from '../realtime/bus.js';
import {
  extractionEnabled, resolveExtractionAccess, getExtractionAiSettings,
} from '../extraction/access.js';
import {
  ELEMENT_TYPES, TEMPLATES, mkElement, validateElement, validateValue,
  compareValues, summarizeConflicts,
  parseDelimited, parseHtmlTables, gridQuality,
  suggestFromText,
  compareToGold,
  consensusToStudyPatch,
} from '../../src/research-engine/extraction/index.js';
import { suggestWithExternalLlm, extractionLlmInfo } from '../services/extractionLlmClient.js';
// 67.md — product-tier enforcement (admins/mods bypass inside the service).
import { requireEntitlement, sendTierLimit } from '../services/entitlementService.js';

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v ?? fallback; } catch { return fallback; }
}
const keyOf = (elementId, armKey) => `${elementId}::${armKey || ''}`;

/** Shared gate: flag → access. Returns access or null (response already sent). */
async function gate(req, res) {
  if (!(await extractionEnabled(req.user))) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await resolveExtractionAccess(req.params.mlpid, req.user);
  if (!access) { res.status(404).json({ error: 'Project not found' }); return null; }
  return access;
}

function blobStudies(project) {
  const data = safeParse(project.data, {});
  return Array.isArray(data.studies) ? data.studies : [];
}

/** Active form for a project, or null. */
async function activeForm(projectId) {
  return prisma.extractionForm.findFirst({
    where: { projectId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}
function formElements(form) {
  const els = safeParse(form?.elements, []);
  return Array.isArray(els) ? els : [];
}

// ── Form / templates ─────────────────────────────────────────────────────────

/** GET /:mlpid/form — active form + template catalogue + element type vocab. */
export async function getForm(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const form = await activeForm(access.project.id);
    res.json({
      form: form ? { id: form.id, name: form.name, templateKey: form.templateKey, version: form.version, elements: formElements(form), updatedAt: form.updatedAt } : null,
      templates: TEMPLATES.map(t => ({ key: t.key, label: t.label, description: t.description, elementCount: t.elements.length })),
      elementTypes: ELEMENT_TYPES,
      canEdit: access.canEdit,
      canAdjudicate: access.canAdjudicate,
      aiSettings: await getExtractionAiSettings(),
      llm: extractionLlmInfo(),
    });
  } catch (e) { console.error('extraction getForm', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** PUT /:mlpid/form {name?, elements?, templateKey?} — create/update the active form. */
export async function putForm(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canEdit) return res.status(403).json({ error: 'Editing the extraction form is not permitted' });
    const body = req.body || {};
    let elements;
    if (body.templateKey && !Array.isArray(body.elements)) {
      const tpl = TEMPLATES.find(t => t.key === body.templateKey);
      if (!tpl) return res.status(400).json({ error: 'Unknown template' });
      elements = tpl.elements.map(e => mkElement(e));
    } else {
      elements = Array.isArray(body.elements) ? body.elements.map(e => mkElement(e)) : [];
    }
    if (elements.length > 200) return res.status(400).json({ error: 'Too many data elements (max 200)' });
    const problems = [];
    for (const el of elements) {
      const v = validateElement(el);
      if (!v.ok) problems.push({ elementId: el.id, name: el.name, errors: v.errors });
    }
    if (problems.length) return res.status(422).json({ error: 'Invalid data elements', problems });

    const existing = await activeForm(access.project.id);
    const form = existing
      ? await prisma.extractionForm.update({
          where: { id: existing.id },
          data: {
            name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : existing.name,
            templateKey: body.templateKey || existing.templateKey,
            elements: JSON.stringify(elements),
            version: { increment: 1 },
          },
        })
      : await prisma.extractionForm.create({
          data: {
            projectId: access.project.id,
            name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'Extraction form',
            templateKey: body.templateKey || null,
            elements: JSON.stringify(elements),
            createdById: access.userId,
          },
        });
    emitToMetaLabProject(access.project.id, access.ownerId, { type: 'project.updated' }, { exclude: access.userId });
    res.json({ ok: true, form: { id: form.id, name: form.name, templateKey: form.templateKey, version: form.version, elements: formElements(form) } });
  } catch (e) { console.error('extraction putForm', e); res.status(500).json({ error: 'Internal server error' }); }
}

// ── Overview / study statuses ────────────────────────────────────────────────

/** GET /:mlpid/overview — per-study extraction status for the workspace list. */
export async function getOverview(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const projectId = access.project.id;
    const studies = blobStudies(access.project);
    const [form, values, assignments, consensus, suggestions] = await Promise.all([
      activeForm(projectId),
      prisma.extractionValue.findMany({ where: { projectId }, select: { studyId: true, userId: true, elementId: true, armKey: true } }),
      prisma.extractionAssignment.findMany({ where: { projectId } }),
      prisma.extractionConsensus.findMany({ where: { projectId }, select: { studyId: true, elementId: true, armKey: true } }),
      prisma.aiExtractionSuggestion.findMany({ where: { projectId }, select: { studyId: true, status: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const elements = formElements(form);
    const requiredCount = elements.filter(e => e.required).length;

    const byStudy = new Map();
    const ensure = (sid) => {
      if (!byStudy.has(sid)) byStudy.set(sid, { extractors: new Map(), consensus: 0, suggestions: 0, reviewedSuggestions: 0 });
      return byStudy.get(sid);
    };
    for (const v of values) {
      const st = ensure(v.studyId);
      st.extractors.set(v.userId, (st.extractors.get(v.userId) || 0) + 1);
    }
    for (const c of consensus) ensure(c.studyId).consensus++;
    for (const s of suggestions) {
      const st = ensure(s.studyId);
      st.suggestions++;
      if (s.status === 'reviewed') st.reviewedSuggestions++;
    }
    const assignByStudy = new Map(assignments.map(a => [a.studyId, a]));

    const rows = studies.map(st => {
      const s = byStudy.get(st.id) || { extractors: new Map(), consensus: 0, suggestions: 0, reviewedSuggestions: 0 };
      const assignment = assignByStudy.get(st.id) || null;
      const myCount = s.extractors.get(access.userId) || 0;
      return {
        studyId: st.id,
        title: st.title || st.author || '(untitled study)',
        author: st.author || '', year: st.year || '',
        assignment: assignment ? {
          status: assignment.status,
          extractor1Id: assignment.extractor1Id, extractor2Id: assignment.extractor2Id,
          adjudicatorId: assignment.adjudicatorId,
        } : null,
        extractorCount: s.extractors.size,
        myValueCount: myCount,
        consensusCount: s.consensus,
        suggestionsPending: Math.max(0, s.suggestions - s.reviewedSuggestions),
        maReady: !!(st.es !== '' && st.lo !== '' && st.hi !== ''),
        requiredCount,
      };
    });
    res.json({
      studies: rows,
      form: form ? { id: form.id, name: form.name, version: form.version, elementCount: elements.length } : null,
      canEdit: access.canEdit,
      canAdjudicate: access.canAdjudicate,
    });
  } catch (e) { console.error('extraction getOverview', e); res.status(500).json({ error: 'Internal server error' }); }
}

// ── Values (per-extractor, blinded) ──────────────────────────────────────────

/** GET /:mlpid/studies/:studyId/values — OWN values + consensus + latest suggestion. */
export async function getStudyValues(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const projectId = access.project.id;
    const { studyId } = req.params;
    const [mine, consensus, assignment, suggestion, form] = await Promise.all([
      prisma.extractionValue.findMany({ where: { projectId, studyId, userId: access.userId } }),
      prisma.extractionConsensus.findMany({ where: { projectId, studyId } }),
      prisma.extractionAssignment.findFirst({ where: { projectId, studyId } }),
      prisma.aiExtractionSuggestion.findFirst({ where: { projectId, studyId }, orderBy: { createdAt: 'desc' } }),
      activeForm(projectId),
    ]);
    const study = blobStudies(access.project).find(s => s.id === studyId) || null;
    res.json({
      studyId,
      study: study ? { id: study.id, title: study.title, author: study.author, year: study.year, abstract: study.abstract || '', doi: study.doi, pmid: study.pmid, es: study.es, lo: study.lo, hi: study.hi, esType: study.esType, outcome: study.outcome, timepoint: study.timepoint } : null,
      elements: formElements(form),
      values: mine.map(v => ({
        elementId: v.elementId, armKey: v.armKey, value: safeParse(v.value, {}),
        provenance: safeParse(v.provenance, {}), origin: v.origin, suggestionId: v.suggestionId,
        updatedAt: v.updatedAt,
      })),
      consensus: consensus.map(c => ({
        elementId: c.elementId, armKey: c.armKey, value: safeParse(c.value, {}),
        source: c.source, aiAssisted: c.aiAssisted, note: c.note,
        resolvedByName: c.resolvedByName, updatedAt: c.updatedAt,
      })),
      assignment,
      suggestion: suggestion ? {
        id: suggestion.id, provider: suggestion.provider, model: suggestion.model,
        status: suggestion.status, createdAt: suggestion.createdAt,
        payload: safeParse(suggestion.payload, []),
      } : null,
    });
  } catch (e) { console.error('extraction getStudyValues', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** PUT /:mlpid/studies/:studyId/values {values:[{elementId,armKey,value,provenance,origin,suggestionId}]} */
export async function putStudyValues(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canEdit) return res.status(403).json({ error: 'Extraction editing is not permitted' });
    const projectId = access.project.id;
    const { studyId } = req.params;
    const study = blobStudies(access.project).find(s => s.id === studyId);
    if (!study) return res.status(404).json({ error: 'Study not found' });
    const form = await activeForm(projectId);
    const elements = formElements(form);
    const elById = new Map(elements.map(e => [e.id, e]));
    const incoming = Array.isArray(req.body?.values) ? req.body.values.slice(0, 500) : [];
    if (!incoming.length) return res.status(400).json({ error: 'No values supplied' });

    const problems = [];
    const rows = [];
    for (const v of incoming) {
      const el = elById.get(v.elementId);
      if (!el) { problems.push({ elementId: v.elementId, errors: ['Unknown data element'] }); continue; }
      const check = validateValue(el, v.value);
      if (!check.ok) { problems.push({ elementId: v.elementId, errors: check.errors }); continue; }
      rows.push({
        elementId: v.elementId,
        armKey: String(v.armKey || ''),
        value: JSON.stringify(check.normalized ?? v.value ?? {}),
        provenance: JSON.stringify(v.provenance && typeof v.provenance === 'object' ? v.provenance : {}),
        origin: ['manual', 'ai_accepted', 'ai_edited'].includes(v.origin) ? v.origin : 'manual',
        suggestionId: v.suggestionId ? String(v.suggestionId) : null,
      });
    }
    if (problems.length) return res.status(422).json({ error: 'Some values are invalid', problems });

    for (const row of rows) {
      await prisma.extractionValue.upsert({
        where: {
          projectId_studyId_elementId_armKey_userId: {
            projectId, studyId, elementId: row.elementId, armKey: row.armKey, userId: access.userId,
          },
        },
        create: {
          projectId, formId: form?.id || '', studyId, userId: access.userId, userName: access.userName,
          ...row,
        },
        update: { value: row.value, provenance: row.provenance, origin: row.origin, suggestionId: row.suggestionId },
      });
    }
    // Keep the assignment status honest (single ↔ dual as extractors accumulate).
    const extractors = await prisma.extractionValue.findMany({
      where: { projectId, studyId }, select: { userId: true }, distinct: ['userId'],
    });
    await prisma.extractionAssignment.upsert({
      where: { projectId_studyId: { projectId, studyId } },
      create: { projectId, studyId, extractor1Id: access.userId, status: extractors.length > 1 ? 'dual' : 'single' },
      update: extractors.length > 1 ? { status: 'dual' } : {},
    }).catch(() => {});
    emitToMetaLabProject(projectId, access.ownerId, { type: 'project.updated' }, { exclude: access.userId });
    res.json({ ok: true, saved: rows.length });
  } catch (e) { console.error('extraction putStudyValues', e); res.status(500).json({ error: 'Internal server error' }); }
}

// ── Assignment / adjudication ────────────────────────────────────────────────

/** POST /:mlpid/studies/:studyId/assign {extractor1Id?, extractor2Id?, adjudicatorId?} */
export async function postAssign(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canAdjudicate) return res.status(403).json({ error: 'Managing assignments is not permitted' });
    const projectId = access.project.id;
    const { studyId } = req.params;
    const b = req.body || {};
    // 67.md — assigning a SECOND extractor is the dual-extraction feature.
    if (b.extractor2Id) {
      try { await requireEntitlement(req.user, 'extraction.dualExtraction'); }
      catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    }
    const data = {
      extractor1Id: b.extractor1Id ? String(b.extractor1Id) : null,
      extractor2Id: b.extractor2Id ? String(b.extractor2Id) : null,
      adjudicatorId: b.adjudicatorId ? String(b.adjudicatorId) : null,
    };
    data.status = data.extractor2Id ? 'dual' : 'single';
    const row = await prisma.extractionAssignment.upsert({
      where: { projectId_studyId: { projectId, studyId } },
      create: { projectId, studyId, ...data },
      update: data,
    });
    res.json({ ok: true, assignment: row });
  } catch (e) { console.error('extraction postAssign', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /:mlpid/studies/:studyId/compare — adjudicator view: both extractors + conflicts. */
export async function getCompare(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canAdjudicate) return res.status(403).json({ error: 'Adjudication is not permitted' });
    const projectId = access.project.id;
    const { studyId } = req.params;
    const [values, consensus, form] = await Promise.all([
      prisma.extractionValue.findMany({ where: { projectId, studyId }, orderBy: { createdAt: 'asc' } }),
      prisma.extractionConsensus.findMany({ where: { projectId, studyId } }),
      activeForm(projectId),
    ]);
    const elements = formElements(form);
    // Group values per extractor (insertion order = extractor A, B, …).
    const byUser = new Map();
    for (const v of values) {
      if (!byUser.has(v.userId)) byUser.set(v.userId, { userId: v.userId, userName: v.userName || '', values: {} });
      byUser.get(v.userId).values[keyOf(v.elementId, v.armKey)] = {
        elementId: v.elementId, armKey: v.armKey,
        value: safeParse(v.value, {}), provenance: safeParse(v.provenance, {}),
        origin: v.origin, updatedAt: v.updatedAt,
      };
    }
    const extractors = [...byUser.values()];
    const [a, b] = extractors;
    let conflicts = null;
    if (a && b) {
      const valuesA = Object.fromEntries(Object.entries(a.values).map(([k, v]) => [k, v.value]));
      const valuesB = Object.fromEntries(Object.entries(b.values).map(([k, v]) => [k, v.value]));
      conflicts = summarizeConflicts(elements, valuesA, valuesB);
    }
    res.json({
      studyId, elements, extractors,
      conflicts,
      consensus: consensus.map(c => ({
        elementId: c.elementId, armKey: c.armKey, value: safeParse(c.value, {}),
        source: c.source, aiAssisted: c.aiAssisted, note: c.note, resolvedByName: c.resolvedByName,
      })),
    });
  } catch (e) { console.error('extraction getCompare', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:mlpid/studies/:studyId/adjudicate {resolutions:[{elementId,armKey,choice,value?,note?}]} */
export async function postAdjudicate(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canAdjudicate) return res.status(403).json({ error: 'Adjudication is not permitted' });
    const projectId = access.project.id;
    const { studyId } = req.params;
    const resolutions = Array.isArray(req.body?.resolutions) ? req.body.resolutions.slice(0, 500) : [];
    if (!resolutions.length) return res.status(400).json({ error: 'No resolutions supplied' });
    const values = await prisma.extractionValue.findMany({ where: { projectId, studyId }, orderBy: { createdAt: 'asc' } });
    const byUser = new Map();
    for (const v of values) {
      if (!byUser.has(v.userId)) byUser.set(v.userId, {});
      byUser.get(v.userId)[keyOf(v.elementId, v.armKey)] = v;
    }
    const [aVals, bVals] = [...byUser.values()];
    const form = await activeForm(projectId);
    const elById = new Map(formElements(form).map(e => [e.id, e]));

    let saved = 0;
    for (const r of resolutions) {
      const el = elById.get(r.elementId);
      if (!el) continue;
      const armKey = String(r.armKey || '');
      const k = keyOf(r.elementId, armKey);
      let value = null, source = null, provenance = {}, aiAssisted = false;
      if (r.choice === 'a' && aVals?.[k]) {
        value = safeParse(aVals[k].value, {}); provenance = safeParse(aVals[k].provenance, {});
        aiAssisted = aVals[k].origin !== 'manual'; source = 'accept_a';
      } else if (r.choice === 'b' && bVals?.[k]) {
        value = safeParse(bVals[k].value, {}); provenance = safeParse(bVals[k].provenance, {});
        aiAssisted = bVals[k].origin !== 'manual'; source = 'accept_b';
      } else if (r.choice === 'agreement' && aVals?.[k]) {
        value = safeParse(aVals[k].value, {}); provenance = safeParse(aVals[k].provenance, {});
        aiAssisted = (aVals[k].origin !== 'manual') || (bVals?.[k] ? bVals[k].origin !== 'manual' : false);
        source = 'agreement';
      } else if (r.choice === 'custom') {
        const check = validateValue(el, r.value);
        if (!check.ok) continue;
        value = check.normalized ?? r.value; source = 'adjudicated';
        provenance = r.provenance && typeof r.provenance === 'object' ? r.provenance : { type: 'manual' };
      } else continue;

      await prisma.extractionConsensus.upsert({
        where: { projectId_studyId_elementId_armKey: { projectId, studyId, elementId: r.elementId, armKey } },
        create: {
          projectId, studyId, elementId: r.elementId, armKey,
          value: JSON.stringify(value), source, aiAssisted,
          note: r.note ? String(r.note).slice(0, 1000) : null,
          provenance: JSON.stringify(provenance),
          resolvedById: access.userId, resolvedByName: access.userName,
        },
        update: {
          value: JSON.stringify(value), source, aiAssisted,
          note: r.note ? String(r.note).slice(0, 1000) : null,
          provenance: JSON.stringify(provenance),
          resolvedById: access.userId, resolvedByName: access.userName,
        },
      });
      saved++;
    }
    await prisma.extractionAssignment.upsert({
      where: { projectId_studyId: { projectId, studyId } },
      create: { projectId, studyId, adjudicatorId: access.userId, status: 'consensus' },
      update: { adjudicatorId: access.userId, status: 'consensus' },
    }).catch(() => {});
    emitToMetaLabProject(projectId, access.ownerId, { type: 'project.updated' }, { exclude: access.userId });
    res.json({ ok: true, saved });
  } catch (e) { console.error('extraction postAdjudicate', e); res.status(500).json({ error: 'Internal server error' }); }
}

// ── AI extraction assist (suggestions only — never auto-commit) ─────────────

/** POST /:mlpid/studies/:studyId/ai-suggest — generate suggestions for review. */
export async function postAiSuggest(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canEdit) return res.status(403).json({ error: 'Extraction editing is not permitted' });
    const settings = await getExtractionAiSettings();
    if (!settings.enabled) return res.status(403).json({ error: 'AI extraction assist is disabled by the administrator' });
    // 67.md — product tier check (in addition to the project permission above).
    try { await requireEntitlement(req.user, 'extraction.aiAssist'); }
    catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const projectId = access.project.id;
    const { studyId } = req.params;
    const study = blobStudies(access.project).find(s => s.id === studyId);
    if (!study) return res.status(404).json({ error: 'Study not found' });
    const form = await activeForm(projectId);
    const elements = formElements(form);
    if (!elements.length) return res.status(400).json({ error: 'Define data elements first' });

    // Assemble the article text we actually have: blob study title/abstract, plus
    // any full text the client supplies (e.g. pasted methods/results section).
    const extraText = typeof req.body?.text === 'string' ? req.body.text.slice(0, 200000) : '';
    const text = [study.title, study.abstract, extraText].filter(Boolean).join('\n\n');
    if (!text.trim()) return res.status(400).json({ error: 'No article text available for this study' });

    let out;
    if (settings.provider === 'external') {
      try {
        out = await suggestWithExternalLlm({ study, text, elements });
      } catch (e) {
        return res.status(502).json({ error: `External AI provider failed: ${e.message}` });
      }
    } else {
      const suggestions = suggestFromText({ title: study.title || '', abstract: study.abstract || '', fullText: extraText }, elements);
      out = { provider: 'heuristic', model: 'heuristic-v1', suggestions };
    }

    const row = await prisma.aiExtractionSuggestion.create({
      data: {
        projectId, studyId,
        provider: out.provider, model: out.model || null,
        payload: JSON.stringify(out.suggestions || []),
        createdById: access.userId,
      },
    });
    res.json({
      ok: true,
      suggestion: { id: row.id, provider: row.provider, model: row.model, status: row.status, payload: out.suggestions || [], createdAt: row.createdAt },
      note: 'Suggestions require human review — nothing has been saved to the extraction.',
    });
  } catch (e) { console.error('extraction postAiSuggest', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:mlpid/suggestions/:sid/review — mark a suggestion set reviewed. */
export async function postSuggestionReview(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const row = await prisma.aiExtractionSuggestion.findFirst({
      where: { id: req.params.sid, projectId: access.project.id },
    });
    if (!row) return res.status(404).json({ error: 'Suggestion not found' });
    await prisma.aiExtractionSuggestion.update({ where: { id: row.id }, data: { status: 'reviewed' } });
    res.json({ ok: true });
  } catch (e) { console.error('extraction postSuggestionReview', e); res.status(500).json({ error: 'Internal server error' }); }
}

// ── Tables ───────────────────────────────────────────────────────────────────

/** GET /:mlpid/tables?studyId= — parsed tables for the project/study. */
export async function getTables(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const where = { projectId: access.project.id };
    if (req.query.studyId) where.studyId = String(req.query.studyId);
    const rows = await prisma.parsedTable.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({
      tables: rows.map(t => ({
        id: t.id, studyId: t.studyId, name: t.name, source: t.source, page: t.page,
        rows: safeParse(t.data, []), quality: t.quality, createdAt: t.createdAt,
      })),
    });
  } catch (e) { console.error('extraction getTables', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:mlpid/tables {content, format?, name?, studyId?, page?} — parse + store. */
export async function postTable(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canEdit) return res.status(403).json({ error: 'Extraction editing is not permitted' });
    const settings = await getExtractionAiSettings();
    if (settings.tableParsingEnabled === false) return res.status(403).json({ error: 'Table parsing is disabled by the administrator' });
    try { await requireEntitlement(req.user, 'extraction.tableParsing'); }
    catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const b = req.body || {};
    const content = String(b.content || '');
    if (!content.trim()) return res.status(400).json({ error: 'No table content supplied' });
    if (content.length > 500000) return res.status(413).json({ error: 'Table content too large' });

    let tables = [];
    if (/<table[\s>]/i.test(content)) {
      tables = parseHtmlTables(content).map(t => ({ caption: t.caption || b.name || '', rows: t.rows, source: 'html' }));
    } else {
      const parsed = parseDelimited(content);
      tables = [{ caption: b.name || '', rows: parsed.rows, source: b.format === 'csv' ? 'csv' : 'paste' }];
    }
    if (!tables.length || !tables[0].rows?.length) return res.status(422).json({ error: 'Could not parse any table from the content' });

    const created = [];
    for (const t of tables.slice(0, 10)) {
      const q = gridQuality(t.rows);
      const row = await prisma.parsedTable.create({
        data: {
          projectId: access.project.id,
          studyId: b.studyId ? String(b.studyId) : null,
          name: (t.caption || b.name || 'Table').slice(0, 300),
          source: t.source,
          page: Number.isFinite(Number(b.page)) ? Number(b.page) : null,
          data: JSON.stringify(t.rows),
          quality: q.score,
          createdById: access.userId,
        },
      });
      created.push({ id: row.id, name: row.name, source: row.source, rows: t.rows, quality: q.score, qualityReasons: q.reasons });
    }
    res.json({ ok: true, tables: created });
  } catch (e) { console.error('extraction postTable', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** DELETE /:mlpid/tables/:tid */
export async function deleteTable(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canEdit) return res.status(403).json({ error: 'Extraction editing is not permitted' });
    const row = await prisma.parsedTable.findFirst({ where: { id: req.params.tid, projectId: access.project.id } });
    if (!row) return res.status(404).json({ error: 'Table not found' });
    await prisma.parsedTable.delete({ where: { id: row.id } });
    res.json({ ok: true });
  } catch (e) { console.error('extraction deleteTable', e); res.status(500).json({ error: 'Internal server error' }); }
}

// ── Meta-analysis handoff ────────────────────────────────────────────────────

/**
 * POST /:mlpid/studies/:studyId/send-to-ma {esType, outcome?, timepoint?, overwrite?}
 * Consensus values → blob study raw fields + calculated effect size, with
 * provenance. Refuses (409) to overwrite an existing human-entered effect size
 * unless overwrite:true.
 */
export async function postSendToMa(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canAdjudicate) return res.status(403).json({ error: 'Sending to meta-analysis requires adjudication permission' });
    const projectId = access.project.id;
    const { studyId } = req.params;
    const consensus = await prisma.extractionConsensus.findMany({ where: { projectId, studyId } });
    if (!consensus.length) return res.status(400).json({ error: 'No consensus values yet — adjudicate first' });
    const form = await activeForm(projectId);
    const elements = formElements(form);

    const consensusValues = {};
    for (const c of consensus) consensusValues[keyOf(c.elementId, c.armKey)] = safeParse(c.value, {});

    const out = consensusToStudyPatch(elements, consensusValues, {
      esType: String(req.body?.esType || ''),
      outcome: req.body?.outcome ? String(req.body.outcome) : undefined,
      timepoint: req.body?.timepoint ? String(req.body.timepoint) : undefined,
    });
    if (!out || !out.patch || !Object.keys(out.patch).length) {
      return res.status(422).json({ error: 'Consensus values do not map to meta-analysis inputs', warnings: out?.warnings || [] });
    }

    const ml = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
    let data;
    try { data = JSON.parse(ml.data || '{}'); } catch { data = {}; }
    if (!Array.isArray(data.studies)) data.studies = [];
    const idx = data.studies.findIndex(s => s.id === studyId);
    if (idx < 0) return res.status(404).json({ error: 'Study not found' });
    const st = data.studies[idx];

    // Never silently overwrite a human-entered effect size (66.md rule 7).
    const hasEs = st.es !== '' && st.es != null;
    if (hasEs && !req.body?.overwrite) {
      return res.status(409).json({
        error: 'This study already has an effect size. Confirm overwrite to replace it with the consensus-derived value.',
        code: 'HAS_EFFECT_SIZE',
        current: { es: st.es, lo: st.lo, hi: st.hi, esType: st.esType },
        proposed: out.patch,
        warnings: out.warnings,
      });
    }

    Object.assign(st, out.patch);
    st.source = 'calculated';
    st.converted = true;
    st.conversions = Array.isArray(st.conversions) ? st.conversions : [];
    st.conversions.push({
      id: Math.random().toString(36).slice(2, 10),
      target: 'es', type: st.esType || out.patch.esType || '',
      method: 'structured-extraction-consensus',
      reason: 'Consensus values from dual extraction sent to meta-analysis',
      at: new Date().toISOString(),
    });
    st.updatedAt = new Date().toISOString();
    data.studies[idx] = st;
    await prisma.project.update({ where: { id: ml.id }, data: { data: JSON.stringify(data), lastSavedAt: new Date() } });
    emitToMetaLabProject(ml.id, access.ownerId, { type: 'project.updated' }, { exclude: access.userId });
    res.json({ ok: true, patch: out.patch, warnings: out.warnings });
  } catch (e) { console.error('extraction postSendToMa', e); res.status(500).json({ error: 'Internal server error' }); }
}

// ── AI validation report (P5.9) ──────────────────────────────────────────────

/** GET /:mlpid/validation-report — AI suggestions vs human consensus (gold). */
export async function getValidationReport(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const projectId = access.project.id;
    const [suggestions, consensus] = await Promise.all([
      prisma.aiExtractionSuggestion.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
      prisma.extractionConsensus.findMany({ where: { projectId } }),
    ]);
    // Latest suggestion per study; gold = consensus values.
    const latestByStudy = new Map();
    for (const s of suggestions) if (!latestByStudy.has(s.studyId)) latestByStudy.set(s.studyId, s);
    const goldByStudy = new Map();
    for (const c of consensus) {
      if (!goldByStudy.has(c.studyId)) goldByStudy.set(c.studyId, []);
      goldByStudy.get(c.studyId).push({ elementId: c.elementId, armKey: c.armKey, value: safeParse(c.value, {}) });
    }
    const perStudy = [];
    for (const [studyId, sugg] of latestByStudy) {
      const gold = goldByStudy.get(studyId);
      if (!gold || !gold.length) continue;
      const report = compareToGold(safeParse(sugg.payload, []), gold);
      perStudy.push({ studyId, provider: sugg.provider, model: sugg.model, suggestedAt: sugg.createdAt, ...report.summary, fields: report.fields });
    }
    if (!perStudy.length) {
      return res.json({ ok: true, studiesCompared: 0, note: 'No studies have both AI suggestions and human consensus values yet — the report needs a human gold standard first.' });
    }
    const agg = (key) => {
      const vals = perStudy.map(s => s[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    res.json({
      ok: true,
      studiesCompared: perStudy.length,
      exactMatchRate: agg('exactMatchRate'),
      withinTolRate: agg('withinTolRate'),
      fieldPrecision: agg('fieldPrecision'),
      fieldRecall: agg('fieldRecall'),
      missingnessAccuracy: agg('missingnessAccuracy'),
      perStudy,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { console.error('extraction getValidationReport', e); res.status(500).json({ error: 'Internal server error' }); }
}
