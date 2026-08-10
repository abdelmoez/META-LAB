/**
 * email/TemplatesTab.jsx — 112.md follow-up — the outbound-email template
 * manager: the registry list merged with override status, and a structured
 * editor per template.
 *
 * The registry (server/services/emailTemplates.js) owns canonical copy; this
 * surface edits OVERRIDES only. Restore Default deletes the override row, and a
 * save whose fields all match the defaults restores automatically — the
 * "customized" badge can never lie.
 *
 * LEGACY DESIGN ONLY (the /ops rule): primitives come from the research package,
 * styles are inline over theme tokens, no Stitch import.
 */
import { useCallback, useEffect, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { adminApi } from '../adminApiClient.js';
import {
  Badge, ConfirmModal, ErrorBox, NoticeBox, SectionCard, Spinner, Table,
  Toggle, accentBtn, fmtDateTime, ghostBtn, inputStyle,
} from '../research/primitives.jsx';
import { draftFromTemplate, fieldsFromDraft } from './fields.js';

const CATEGORY_COLOR = { transactional: C.acc, optional: C.purp };

/* ─── Variable helper chips ──────────────────────────────────────────────── */

/**
 * One clickable chip per declared variable, straight from the registry entry.
 * Clicking appends the [token] to the body draft — the fastest way to put a
 * variable back after over-editing, and a live reminder of what exists.
 */
function VariableChips({ template, onInsert }) {
  const chip = (name, required) => (
    <button
      key={name}
      type="button"
      data-testid={`em-var-${name}`}
      title={required
        ? `Required — [${name}] must appear in the subject or a body paragraph.`
        : `Optional variable. Click to insert [${name}] into the body.`}
      onClick={() => onInsert(`[${name}]`)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
        borderRadius: 12, fontSize: 10.5, fontFamily: MONO, cursor: 'pointer',
        color: required ? C.acc : C.txt2,
        background: alpha(required ? C.acc : C.muted, '12'),
        border: `1px solid ${alpha(required ? C.acc : C.muted, '40')}`,
      }}
    >
      [{name}]{required ? <span style={{ fontWeight: 700 }}>*</span> : null}
    </button>
  );
  return (
    <div data-testid="em-var-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Variables
      </span>
      {template.requiredVariables.map((n) => chip(n, true))}
      {template.optionalVariables.map((n) => chip(n, false))}
      {template.requiredVariables.length > 0 && (
        <span style={{ fontSize: 10.5, color: C.muted }}>* required — must stay in the subject or body</span>
      )}
    </div>
  );
}

/* ─── Editor ─────────────────────────────────────────────────────────────── */

const fieldLabelStyle = {
  fontSize: 9.5, fontFamily: MONO, color: C.muted,
  letterSpacing: '0.08em', textTransform: 'uppercase',
};

/**
 * TemplateEditor — structured fields (never raw HTML), preview via a sandboxed
 * srcDoc iframe, enable/disable ONLY where the registry says disableable,
 * restore-default behind a confirm, and a test-send to the calling admin.
 * Exported for the SSR test.
 */
export function TemplateEditor({ template, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => draftFromTemplate(template));
  const [preview, setPreview] = useState(null); // { subject, html, text }
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');       // 'save' | 'restore' | 'toggle' | 'test'
  const [modal, setModal] = useState('');     // '' | 'save' | 'restore' | 'toggle'
  const [pendingEnabled, setPendingEnabled] = useState(template.enabled);
  const [reason, setReason] = useState('');

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const insertToken = (token) => setDraft((d) => ({ ...d, bodyText: d.bodyText ? `${d.bodyText} ${token}` : token }));

  const closeModal = () => { setModal(''); setReason(''); };

  async function runPreview() {
    setPreviewBusy(true);
    setError('');
    try {
      const p = await adminApi.email.preview(template.key, fieldsFromDraft(draft));
      setPreview(p);
    } catch (e) {
      setError(e?.message || 'Preview failed.');
    } finally {
      setPreviewBusy(false);
    }
  }

  async function commitSave() {
    setBusy('save');
    setError('');
    try {
      const res = await adminApi.email.saveTemplate(template.key, fieldsFromDraft(draft), reason);
      closeModal();
      setNotice(res?.template?.hasOverride
        ? 'Saved. This template now uses your customized copy.'
        : 'Saved. The fields match the defaults, so the template is back on registry copy.');
      if (onSaved && res?.template) onSaved(res.template);
    } catch (e) {
      setError(e?.message || 'Save failed.');
    } finally {
      setBusy('');
    }
  }

  async function commitRestore() {
    setBusy('restore');
    setError('');
    try {
      const res = await adminApi.email.restoreTemplate(template.key, reason);
      closeModal();
      setNotice('Restored to the registry default copy.');
      if (res?.template) {
        setDraft(draftFromTemplate(res.template));
        setPreview(null);
        if (onSaved) onSaved(res.template);
      }
    } catch (e) {
      setError(e?.message || 'Restore failed.');
    } finally {
      setBusy('');
    }
  }

  async function commitToggle() {
    setBusy('toggle');
    setError('');
    try {
      const res = await adminApi.email.setEnabled(template.key, pendingEnabled, reason);
      closeModal();
      setNotice(pendingEnabled ? 'Template re-enabled.' : 'Template disabled — the outbox will skip it.');
      if (onSaved && res?.template) onSaved(res.template);
    } catch (e) {
      setError(e?.message || 'Could not change the enabled state.');
    } finally {
      setBusy('');
    }
  }

  async function runTestSend() {
    setBusy('test');
    setError('');
    try {
      const res = await adminApi.email.testSend(template.key);
      setNotice(res?.emailConfigured
        ? `Test email queued to ${res.recipient}.`
        : `Test email queued to ${res?.recipient || 'you'} — SMTP is not configured, so it will be recorded as skipped (no SMTP) in Delivery.`);
    } catch (e) {
      setError(e?.message || 'Test send failed.');
    } finally {
      setBusy('');
    }
  }

  const textField = (label, key, testId, width = '100%') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 240px' }}>
      <label style={fieldLabelStyle}>{label}</label>
      <input data-testid={testId} value={draft[key]} onChange={set(key)} style={{ ...inputStyle, width }} />
    </div>
  );

  return (
    <SectionCard
      testId="em-editor"
      title={`Edit "${template.key}"`}
      subtitle={template.description}
      action={(
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {template.disableable && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 11, color: C.txt2 }}>{template.enabled ? 'Enabled' : 'Disabled'}</span>
              <Toggle
                checked={template.enabled}
                testId="em-enabled-toggle"
                onChange={(next) => { setPendingEnabled(next); setModal('toggle'); }}
              />
            </div>
          )}
          <button data-testid="em-editor-close" onClick={onClose} style={ghostBtn}>Close</button>
        </div>
      )}
    >
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!template.disableable && (
          <NoticeBox tone={C.acc} testId="em-transactional-note">
            <strong>Transactional email.</strong> It is part of an action a user just took (registry category
            policy), so it has no off switch — only its copy can be adjusted.
          </NoticeBox>
        )}
        {error && <ErrorBox msg={error} />}
        {notice && (
          <NoticeBox tone={C.grn} testId="em-editor-notice">{notice}</NoticeBox>
        )}

        <VariableChips template={template} onInsert={insertToken} />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {textField('Subject', 'subject', 'em-field-subject')}
          {textField('Heading', 'heading', 'em-field-heading')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={fieldLabelStyle}>Body paragraphs — a blank line starts a new paragraph</label>
          <textarea
            data-testid="em-field-body"
            value={draft.bodyText}
            onChange={set('bodyText')}
            rows={12}
            style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: FONT, lineHeight: 1.6 }}
          />
          <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
            Registry syntax works here: <span style={{ fontFamily: MONO }}>[variable]</span>,{' '}
            <span style={{ fontFamily: MONO }}>**bold**</span>, <span style={{ fontFamily: MONO }}>[[cta]]</span> to place the
            button, <span style={{ fontFamily: MONO }}>@if:name&nbsp;</span>/<span style={{ fontFamily: MONO }}>@ifnot:name&nbsp;</span>{' '}
            conditionals, and the <span style={{ fontFamily: MONO }}>&gt;&nbsp;</span>/<span style={{ fontFamily: MONO }}>!&gt;&nbsp;</span>/
            <span style={{ fontFamily: MONO }}>~&nbsp;</span> style prefixes. Variable values are always escaped — copy here can
            never inject markup.
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {textField('CTA label', 'ctaLabel', 'em-field-ctaLabel')}
          {textField('CTA link', 'ctaHref', 'em-field-ctaHref')}
          {textField('Footer note', 'footerNote', 'em-field-footerNote')}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button data-testid="em-preview-btn" onClick={runPreview} disabled={previewBusy} style={ghostBtn}>
            {previewBusy ? <Spinner size={11} /> : <Icon name="eye" size={12} />} Preview
          </button>
          <button data-testid="em-save" onClick={() => setModal('save')} style={accentBtn}>Save copy…</button>
          <button data-testid="em-test-send" onClick={runTestSend} disabled={busy === 'test'} style={ghostBtn}>
            {busy === 'test' ? <Spinner size={11} /> : <Icon name="send" size={12} />} Send test to me
          </button>
          {template.hasOverride && (
            <button data-testid="em-restore" onClick={() => setModal('restore')} style={{ ...ghostBtn, color: C.red, borderColor: alpha(C.red, '50') }}>
              Restore default…
            </button>
          )}
          <span style={{ fontSize: 10.5, color: C.muted, marginLeft: 'auto' }}>
            {template.hasOverride
              ? `Customized${template.overrideUpdatedAt ? ` · ${fmtDateTime(template.overrideUpdatedAt)}` : ''}`
              : 'Using registry defaults'}
          </span>
        </div>

        {preview && (
          <div data-testid="em-preview" style={{ border: `1px solid ${C.brd}`, borderRadius: 9, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.brd}`, fontSize: 12, color: C.txt }}>
              <span style={{ ...fieldLabelStyle, marginRight: 8 }}>Subject</span>
              <span data-testid="em-preview-subject">{preview.subject}</span>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
                Rendered with deterministic sample values — the same draft always previews identically.
              </div>
            </div>
            <iframe
              data-testid="em-preview-frame"
              title={`Preview of ${template.key}`}
              srcDoc={preview.html}
              sandbox=""
              style={{ width: '100%', height: 480, border: 'none', background: '#f3f4f6', display: 'block' }}
            />
            <details style={{ padding: '8px 14px', borderTop: `1px solid ${C.brd}` }}>
              <summary style={{ fontSize: 11, color: C.txt2, cursor: 'pointer' }}>Plain-text part</summary>
              <pre data-testid="em-preview-text" style={{ fontSize: 11, fontFamily: MONO, color: C.txt2, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
                {preview.text}
              </pre>
            </details>
          </div>
        )}
      </div>

      <ConfirmModal
        open={modal === 'save'}
        testId="em-save"
        title={`Save copy for "${template.key}"?`}
        confirmLabel="Save copy"
        busy={busy === 'save'}
        reason={reason}
        onReason={setReason}
        onCancel={closeModal}
        onConfirm={commitSave}
      >
        Only the fields that differ from the registry defaults are stored as an override; if everything matches the
        defaults, the template simply returns to registry copy. The change is recorded in the audit log with a
        before → after diff.
      </ConfirmModal>

      <ConfirmModal
        open={modal === 'restore'}
        testId="em-restore"
        title={`Restore "${template.key}" to its default copy?`}
        confirmLabel="Restore default"
        danger
        busy={busy === 'restore'}
        reason={reason}
        onReason={setReason}
        onCancel={closeModal}
        onConfirm={commitRestore}
      >
        The stored override is deleted and the registry copy becomes effective again immediately. Your customized
        fields are not kept anywhere — copy them out first if you may want them back.
      </ConfirmModal>

      <ConfirmModal
        open={modal === 'toggle'}
        testId="em-toggle"
        title={pendingEnabled ? `Re-enable "${template.key}"?` : `Disable "${template.key}"?`}
        confirmLabel={pendingEnabled ? 'Enable' : 'Disable'}
        danger={!pendingEnabled}
        busy={busy === 'toggle'}
        reason={reason}
        onReason={setReason}
        onCancel={closeModal}
        onConfirm={commitToggle}
      >
        {pendingEnabled
          ? 'Queued and future sends of this template will go out again.'
          : 'The outbox worker will skip every send of this template (recorded as "skipped (disabled)" in Delivery). Only optional templates can be disabled — access-critical email has no off switch.'}
      </ConfirmModal>
    </SectionCard>
  );
}

/* ─── Tab ────────────────────────────────────────────────────────────────── */

/**
 * `initialTemplates` exists for SSR tests (effects do not run there); the live
 * console always loads from GET /api/admin/email/templates.
 */
export default function TemplatesTab({ initialTemplates = null }) {
  const [templates, setTemplates] = useState(initialTemplates || []);
  const [loading, setLoading] = useState(!initialTemplates);
  const [error, setError] = useState('');
  const [emailConfigured, setEmailConfigured] = useState(null);
  const [selectedKey, setSelectedKey] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi.email.templates()
      .then((d) => {
        setTemplates(Array.isArray(d?.templates) ? d.templates : []);
        setEmailConfigured(d?.emailConfigured === true);
      })
      .catch((e) => setError(e?.message || 'Could not load the email templates.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = templates.find((t) => t.key === selectedKey) || null;

  const onSaved = (updated) => {
    setTemplates((rows) => rows.map((t) => (t.key === updated.key ? updated : t)));
  };

  const columns = [
    {
      key: 'key',
      label: 'Template',
      render: (t) => (
        <span data-testid={`em-template-row-${t.key}`} style={{ display: 'block', maxWidth: 420 }}>
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.txt, fontWeight: 600 }}>{t.key}</span>
          <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>{t.description}</span>
        </span>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (t) => <Badge text={t.category} color={CATEGORY_COLOR[t.category] || C.muted} />,
    },
    {
      key: 'copy',
      label: 'Copy',
      render: (t) => (t.hasOverride
        ? <Badge text="customized" color={C.ylw} title={t.overrideUpdatedAt ? `Overridden ${fmtDateTime(t.overrideUpdatedAt)}` : 'Overridden'} />
        : <Badge text="default" color={C.muted} />),
    },
    {
      key: 'enabled',
      label: 'Enabled',
      render: (t) => (t.disableable
        ? <Badge text={t.enabled ? 'on' : 'off'} color={t.enabled ? C.grn : C.red} />
        : <span title="Transactional — cannot be disabled" style={{ color: C.muted, fontSize: 11 }}>always</span>),
    },
    {
      key: 'actions',
      label: '',
      render: (t) => (
        <button data-testid={`em-edit-${t.key}`} onClick={() => setSelectedKey(t.key)} style={ghostBtn}>Edit</button>
      ),
    },
  ];

  return (
    <div>
      <NoticeBox tone={C.acc} testId="em-templates-scope">
        <strong>The registry owns canonical copy.</strong> Edits here are stored as overrides; Restore Default deletes
        the override and the shipped copy takes effect again. Only optional templates (currently the welcome email)
        can be disabled — transactional email has no off switch. Email bodies are never stored in the database.
      </NoticeBox>
      {emailConfigured === false && (
        <NoticeBox tone={C.ylw} testId="em-smtp-note">
          SMTP is not configured in this environment. Sends (including test sends) are recorded in Delivery as
          "skipped (no SMTP)" with their rendered subject.
        </NoticeBox>
      )}
      {error && <ErrorBox msg={error} />}

      {selected && (
        <TemplateEditor
          key={selected.key}
          template={selected}
          onSaved={onSaved}
          onClose={() => setSelectedKey('')}
        />
      )}

      <SectionCard
        testId="em-templates"
        title="Outbound email templates"
        subtitle="Every email the product can send, from the code-owned registry, merged with its override status."
        action={<button data-testid="em-templates-reload" onClick={load} style={ghostBtn}><Icon name="refresh" size={12} /> Refresh</button>}
      >
        <Table
          testId="em-templates-table"
          columns={columns}
          rows={templates}
          loading={loading}
          rowKey={(t) => t.key}
          emptyMessage="No templates in the registry — that would be a build error."
        />
      </SectionCard>
    </div>
  );
}
