// screeningApi.js — API client for META·SIFT Beta
const BASE = '/api/screening';

async function req(method, path, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + path, opts);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      r.status === 401 ? 'You must be signed in to use Screening.' :
      r.status === 403 ? 'Access denied.' :
      r.status === 404 ? (data.error || 'Not found.') :
      r.status === 503 ? (data.error || 'Screening is currently unavailable.') :
      (data.error || `Server error (${r.status})`);
    throw Object.assign(new Error(msg), { status: r.status, data });
  }
  return data;
}

export const screeningApi = {
  // Health
  health: () => req('GET', '/health'),

  // Projects
  listProjects:  ()                       => req('GET',    '/projects'),
  // body may include alsoCreateMetaLab:true (prompt6 Task 2 — optional SIFT-side
  // "also create & link a META·LAB project" flow; never forced, default off).
  createProject: (body)                   => req('POST',   '/projects', body),
  getProject:    (pid)                    => req('GET',    `/projects/${pid}`),
  // body may include { title } — owner/leader rename (prompt6 Task 18). The server
  // syncs the linked META·LAB project name iff the titles were equal before.
  updateProject: (pid, body)              => req('PUT',    `/projects/${pid}`, body),
  deleteProject: (pid)                    => req('DELETE', `/projects/${pid}`),

  // Records
  listRecords: (pid, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req('GET', `/projects/${pid}/records${qs ? '?' + qs : ''}`);
  },
  getKeywordStats: (pid) => req('GET', `/projects/${pid}/keyword-stats`),
  deleteRecord: (pid, rid) => req('DELETE', `/projects/${pid}/records/${rid}`),

  // Import / Export
  // POST /projects/:pid/import — body { format, content, filename }. The server
  // fingerprints the file (SHA-256) and answers 409 { error: 'duplicate_import',
  // batch: { filename, importedAt, importedByName, recordCount } } when the same
  // file was already imported into this project (prompt6 Task 19). Pass
  // force=true to "Import anyway" (record-level DOI/PMID/title dedupe still
  // applies). Thrown errors carry .status and .data (the parsed JSON body).
  importRecords: (pid, body, { force = false } = {}) =>
    req('POST', `/projects/${pid}/import`, force ? { ...body, force: true } : body),
  // prompt50 WS2 — durable async import. startImport returns 202 { jobId } (or
  // 409 duplicate_import like the sync path); poll getImportJob until the status
  // is completed / completed_with_warnings / failed. The browser need not stay open.
  startImport: (pid, body, { force = false } = {}) =>
    req('POST', `/projects/${pid}/import/start`, force ? { ...body, force: true } : body),
  getImportJob: (pid, jobId) =>
    req('GET', `/projects/${pid}/import/jobs/${jobId}`),
  // params: { format: 'csv'|'json'|'ris', filter } — no client-side format
  // validation here; the ExportDialog item declares the valid formats and the
  // server generates the file (prompt9 Task 6 adds 'ris').
  exportUrl: (pid, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return `${BASE}/projects/${pid}/export${qs ? '?' + qs : ''}`;
  },
  // 62.md — durable async export for large projects. The sync GET /export answers 413
  // { useAsync:true } over the size cap; the client then starts a job, polls getExportJob
  // until { ready:true }, and downloads from exportDownloadUrl. Mirrors the import job API.
  startExport:   (pid, body)        => req('POST', `/projects/${pid}/export/start`, body),
  getExportJob:  (pid, jobId)       => req('GET',  `/projects/${pid}/export/jobs/${jobId}`),
  exportDownloadUrl: (pid, jobId)   => `${BASE}/projects/${pid}/export/jobs/${jobId}/download`,

  // Decisions
  saveDecision:  (pid, rid, body) => req('POST', `/projects/${pid}/records/${rid}/decision`, body),
  listDecisions: (pid)            => req('GET',  `/projects/${pid}/decisions`),

  // Conflicts
  listConflicts:   (pid)          => req('GET',  `/projects/${pid}/conflicts`),
  resolveConflict: (pid, cid, body) => req('POST', `/projects/${pid}/conflicts/${cid}/resolve`, body),

  // Presence + field locking (prompt23) — ephemeral; all best-effort on the client.
  getPresence:       (pid)       => req('GET',  `/projects/${pid}/presence`),
  presenceHeartbeat: (pid, body) => req('POST', `/projects/${pid}/presence/heartbeat`, body),
  presenceLeave:     (pid)       => req('POST', `/projects/${pid}/presence/leave`, {}),
  acquireLock:       (pid, body) => req('POST', `/projects/${pid}/locks/acquire`, body),
  releaseLock:       (pid, body) => req('POST', `/projects/${pid}/locks/release`, body),

  // Duplicates
  listDuplicates:        (pid)            => req('GET',  `/projects/${pid}/duplicates`),
  detectDuplicates:      (pid)            => req('POST', `/projects/${pid}/duplicates/detect`, {}),
  resolveDuplicateGroup: (pid, gid, body) => req('POST', `/projects/${pid}/duplicates/${gid}/resolve`, body),

  // Labels
  listLabels:  (pid)       => req('GET',    `/projects/${pid}/labels`),
  createLabel: (pid, body) => req('POST',   `/projects/${pid}/labels`, body),
  deleteLabel: (pid, lid)  => req('DELETE', `/projects/${pid}/labels/${lid}`),

  // Reasons
  listReasons:  (pid)        => req('GET',    `/projects/${pid}/reasons`),
  createReason: (pid, body)  => req('POST',   `/projects/${pid}/reasons`, body),
  deleteReason: (pid, rid2)  => req('DELETE', `/projects/${pid}/reasons/${rid2}`),

  // Stats + Overview
  getStats:    (pid) => req('GET', `/projects/${pid}/stats`),
  getOverview: (pid) => req('GET', `/projects/${pid}/overview`),
  getAudit:    (pid) => req('GET', `/projects/${pid}/audit`),
  // 58.md §5 — import history (datasets) + owner/admin batch deletion.
  listImportBatches: (pid)          => req('GET',    `/projects/${pid}/import-batches`),
  deleteImportBatch: (pid, batchId, confirm) => req('DELETE', `/projects/${pid}/import-batches/${batchId}`, { confirm }),

  // Members (Part 4)
  listMembers:  (pid)            => req('GET',    `/projects/${pid}/members`),
  // prompt33 Task 2 — look up a registered user by email before add-vs-invite.
  // Returns { found, alreadyMember?, currentRole?, user? }. canManageMembers-gated.
  lookupMember: (pid, email)     => req('GET',    `/projects/${pid}/members/lookup?email=${encodeURIComponent(email)}`),
  // body: { email, preset, modules?: 'metalab'|'metasift'|'both' } — modules
  // narrows which apps the member participates in (prompt6 Task 6; default both).
  addMember:    (pid, body)      => req('POST',   `/projects/${pid}/members`, body),
  // body: { preset } | { role, status } | raw permission flags (canScreen, …).
  updateMember: (pid, mid, body) => req('PATCH',  `/projects/${pid}/members/${mid}`, body),
  removeMember: (pid, mid)       => req('DELETE', `/projects/${pid}/members/${mid}`),
  // Self-service exit (prompt9) — 200 {left:true}; the owner gets 400 with
  // transfer-ownership messaging (surfaced as the thrown error message).
  leaveProject: (pid)            => req('POST',   `/projects/${pid}/leave`),
  // Transfer ownership (prompt11, owner-only) — hands the workspace (and its
  // linked META·LAB project) to another active member. 200 { ok:true, ownerId }.
  // 400 (not an active member / already owner), 403 (not owner), 409 (analysis
  // shared by >1 workspace) — surfaced as the thrown error message.
  transferOwner: (pid, toUserId) => req('POST',   `/projects/${pid}/transfer-owner`, { toUserId }),
  // Archive / unarchive a workspace (owner-only, prompt11).
  // Respond { archived: true|false }. Cascaded from the META·LAB archive
  // action; also available as a direct workspace-side action.
  archiveProject:   (pid) => req('POST', `/projects/${pid}/archive`),
  unarchiveProject: (pid) => req('POST', `/projects/${pid}/unarchive`),

  // Per-member open-state (Part 11)
  markOpened: (pid, rid) => req('POST', `/projects/${pid}/records/${rid}/open`),

  // META·LAB association (Task 4)
  getLinkable:  (pid)                  => req('GET',  `/projects/${pid}/linkable`),
  linkMetaLab:  (pid, metaLabProjectId) => req('POST', `/projects/${pid}/link`, { metaLabProjectId }),

  // Unified Review Workspace (prompt18) — resolve/ensure the internal screening
  // module for a META·LAB project. Returns { screenProjectId, created, repaired }.
  // Owner: creates it silently if missing. Member: resolves it. 404 = no access.
  getWorkspace: (mlpid)                => req('GET',  `/metalab/${mlpid}/workspace`),
  // prompt29 Part 2 — resolve the screening record a META·LAB study came from, so
  // the RoB workspace can reuse this project's PDF panel for the same paper.
  metalabStudyRecord: (mlpid, studyId) => req('GET',  `/metalab/${mlpid}/study-record/${encodeURIComponent(studyId)}`),

  // Second Review / Final Review (Part 3; prompt21)
  listSecondReview: (pid)            => req('GET',  `/projects/${pid}/second-review`),
  finalizeRecord:   (pid, rid, body) => req('POST', `/projects/${pid}/records/${rid}/finalize`, body),
  retryHandoff:     (pid, rid)       => req('POST', `/projects/${pid}/records/${rid}/handoff/retry`),
  // Revert a "sent to Data Extraction" final-review decision (safe; restorable).
  revertFinalReview:(pid, rid)       => req('POST', `/projects/${pid}/records/${rid}/final-review/revert`),

  // Chat (Part 6) — polling via ?since
  listChat: (pid, since) => req('GET', `/projects/${pid}/chat${since ? '?since=' + encodeURIComponent(since) : ''}`),
  postChat: (pid, body)  => req('POST', `/projects/${pid}/chat`, body),
  deleteChat: (pid, cmid) => req('DELETE', `/projects/${pid}/chat/${cmid}`),
  chatUnreadCount: (pid) => req('GET',  `/projects/${pid}/chat/unread-count`),
  markChatRead:    (pid) => req('POST', `/projects/${pid}/chat/mark-read`),
  chatTyping:      (pid) => req('POST', `/projects/${pid}/chat/typing`),

  // Chat — META·LAB door (prompt7). SAME thread as /projects/:pid/chat,
  // addressed by the linked META·LAB project id. Response shapes mirror the
  // /projects/:pid/chat family. 404 ⇒ no linked META·SIFT project (or no
  // access — existence-hiding contract). Note the door naming difference:
  // metalab uses '/chat/read', sift uses '/chat/mark-read'.
  metalabListChat:        (mlpid, since) => req('GET',    `/metalab/${mlpid}/chat${since ? '?since=' + encodeURIComponent(since) : ''}`),
  metalabPostChat:        (mlpid, body)  => req('POST',   `/metalab/${mlpid}/chat`, body),
  metalabChatUnreadCount: (mlpid)        => req('GET',    `/metalab/${mlpid}/chat/unread-count`),
  metalabMarkChatRead:    (mlpid)        => req('POST',   `/metalab/${mlpid}/chat/read`),
  metalabChatTyping:      (mlpid, typing = true) => req('POST', `/metalab/${mlpid}/chat/typing`, { typing }),
  metalabDeleteChat:      (mlpid, cmid)  => req('DELETE', `/metalab/${mlpid}/chat/${cmid}`),

  // PDF attachments (Part 7)
  listPdf:        (pid, rid) => req('GET', `/projects/${pid}/records/${rid}/pdf`),
  pdfDownloadUrl: (pid, rid, aid) => `${BASE}/projects/${pid}/records/${rid}/pdf/${aid}/download`,
  deletePdf:      (pid, rid, aid) => req('DELETE', `/projects/${pid}/records/${rid}/pdf/${aid}`),
  uploadPdf: async (pid, rid, file) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`${BASE}/projects/${pid}/records/${rid}/pdf`, { method: 'POST', credentials: 'include', body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Upload failed (${r.status})`), { status: r.status, data });
    return data;
  },

  // Open-access PDF retrieval + uploaded-PDF matching (roadmap 1.4). oaRetrieve
  // uses the signed-in user's account email as the OA provider's polite-pool
  // identifier (server-side). Pass recordIds to target specific records.
  oaRetrieve: (pid, recordIds) => req('POST', `/projects/${pid}/oa-retrieve`, recordIds ? { recordIds } : {}),
  matchPdfs:  (pid, pdfs)      => req('POST', `/projects/${pid}/match-pdfs`, { pdfs }),
};
