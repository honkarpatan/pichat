// src/main/utils/agent/AgentActionUI.js
/**
 * Shared Grok-like agent action UI for LiveChatUI + ChatRenderer.
 * - Internal system verbs hidden (Nudge / Force / Pipeline…)
 * - Lists collapse under "Listed N items"
 * - Outer shell: "Worked for 24s" (Grok-style)
 * - File rows: eye icon for preview (no "Preview path" spam)
 */

export function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}


/** Shared "2m 6s" / "24s" fragment */
function formatDurationBits(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/** Done state: "Worked for 24s" / "Worked for 2m 15s" */
export function formatWorkedDuration(sec) {
  const s = Math.max(1, Math.round(Number(sec) || 0));
  return `Worked for ${formatDurationBits(s)}`;
}

/** In-progress: "Working for 2m 6s" (live timer uses this) */
export function formatWorkingDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `Working for ${formatDurationBits(s)}`;
}

/** System/debug rows users should not see as "patch" noise */
export function isInternalAction(a) {
  const v = String(a?.verb || a?.target || '');
  return /^(Nudge|Pipeline|Codegen|Tools|Force|Re-?init|Emit|Intercept|Continue|Re-initializ)/i.test(v)
    || /force write|must write|file= code|full source \(no tools\)/i.test(v);
}

function fileTreeHtml(entries, esc = escapeHtml) {
  const list = Array.isArray(entries) ? entries.slice(0, 60) : [];
  if (!list.length) {
    return `<div class="gpt-file-tree"><div class="gpt-file-row"><span class="gpt-file-name" style="opacity:.45">empty</span></div></div>`;
  }
  const rows = list.map(e => {
    // Web search link row (title + url, no extra header)
    if (e.url || e.type === 'link') {
      const title = esc(e.name || e.title || e.url || 'Link');
      const url = esc(e.url || '');
      return `<div class="gpt-file-row is-link" data-url="${url}" style="cursor:pointer">
        <svg class="gpt-fi" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        <span class="gpt-file-name">${title}</span>
        ${url ? `<span class="gpt-file-meta" style="opacity:.55;font-size:10px;margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%">${url}</span>` : ''}
      </div>`;
    }
    const isDir = !!(e.isDirectory || e.type === 'directory');
    const icon = isDir
      ? `<svg class="gpt-fi" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
      : `<svg class="gpt-fi" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    return `<div class="gpt-file-row ${isDir ? 'is-dir' : 'is-file'}">${icon}<span class="gpt-file-name">${esc(e.name || '')}</span></div>`;
  }).join('');
  return `<div class="gpt-file-tree">${rows}</div>`;
}

const EYE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

export function actionSummary(a) {
  const fc = a.fcName || '';
  const n = Array.isArray(a.entries) ? a.entries.length : 0;
  const label = a.label || a.target || '';

  if (fc === 'web_search' || a.kind === 'web' || /^(Searching|Searched)/i.test(String(a.verb || ''))) {
    if (/Searching/i.test(String(a.verb || ''))) return { verb: 'Searching', meta: label || 'web', label: '' };
    if (n) return { verb: 'Searched', meta: `${n} result${n === 1 ? '' : 's'}`, label: '' };
    return { verb: 'Searched', meta: label || 'web', label: '' };
  }
  if (fc === 'list_directory' || a.kind === 'tree') {
    if (n) return { verb: 'Listed', meta: `${n} item${n === 1 ? '' : 's'}`, label: '' };
    return { verb: 'Listed', meta: label || 'folder', label: '' };
  }
  if (fc === 'list_open_project_folders') {
    return { verb: 'Projects', meta: n ? `${n} open` : 'checked', label: '' };
  }
  if (fc === 'create_file_tree') {
    const m = String(a.verb || '').match(/(\d+)/);
    return { verb: 'Created', meta: m ? `${m[1]} items` : (label || ''), label: label };
  }
  if (fc === 'run_shell_command' || a.kind === 'command') {
    return { verb: 'Terminal', meta: 'command', label: '' };
  }
  if (fc === 'read_file') {
    return { verb: 'Read', meta: label.split('/').pop() || label, label: '' };
  }
  if (fc === 'create_or_update_file' || /Wrote|Updated|Saved|Scaffold/i.test(String(a.verb || ''))) {
    return { verb: /Saved|Wrote|Created/i.test(String(a.verb || '')) ? 'Saved' : (a.verb || 'Saved'), meta: label.split('/').pop() || label, label: '' };
  }
  if (fc === 'search_replace_edit' || /Replaced/i.test(String(a.verb || ''))) {
    return { verb: 'Updated', meta: label.split('/').pop() || label, label: '' };
  }
  if (fc === 'finish_task') {
    return { verb: 'Done', meta: '', label: '' };
  }
  return { verb: a.verb || 'Step', meta: label, label: '' };
}

/**
 * One action row — lists always collapsed by default on history.
 */
export function buildActionDetailsHtml(a, opts = {}) {
  if (isInternalAction(a)) return '';
  const esc = escapeHtml;
  const open = !!opts.open;
  const isError = a.status === 'error';
  const statusClass = isError ? 'is-error' : 'is-success';
  const sum = actionSummary(a);
  const hasEntries = Array.isArray(a.entries) && a.entries.length > 0;
  const hasCmd = (a.kind === 'command' || a.fcName === 'run_shell_command') && a.detail;
  const hasErr = isError && a.detail;
  // Rate-limit / status row — plain text body (no code block)
  const hasStatusDetail =
    (a.kind === 'status' || a.fcName === 'rate_limit_retry' || a.fcName === 'api_key_failover') && a.detail;
  // File-write diffs → FileCards only (eye + +N −M). No dual <pre> dumps under the step.
  const isFileWrite =
    a.fcName === 'create_or_update_file' ||
    a.fcName === 'search_replace_edit' ||
    a.fcName === 'edit_file_lines' ||
    a.fcName === 'update_active_file_content' ||
    /^(Saved|Save failed|Writing|Wrote|Updated|Patch|Edited|Scaffold)/i.test(String(a.verb || ''));
  const hasDiff = !isFileWrite && !!(a.oldContent || a.newContent);
  const hasBody = hasEntries || hasCmd || hasErr || hasDiff || hasStatusDetail;

  let body = '';
  if (hasEntries) body = fileTreeHtml(a.entries, esc);
  else if (hasStatusDetail) {
    body = `<div class="gpt-status-reason" style="font-size:12px;opacity:0.75;padding:4px 2px;line-height:1.4;white-space:normal;">${esc(String(a.detail).slice(0, 300))}</div>`;
  } else if (hasCmd) {
    const cmd = a.fcArgs?.command
      ? `<div class="gpt-term-cmd"><span class="gpt-term-prompt">$</span> ${esc(String(a.fcArgs.command).slice(0, 180))}</div>`
      : '';
    body = `${cmd}<pre class="gpt-term-out" data-gpt-no-copy="1"><code>${esc(String(a.detail).slice(0, 500))}</code></pre>`;
  } else if (hasDiff) {
    body = `<div class="gpt-agent-diff-body"><pre data-gpt-no-copy="1" class="gpt-diff-old">${esc(String(a.oldContent || '').slice(0, 600))}</pre><pre data-gpt-no-copy="1" class="gpt-diff-new">${esc(String(a.newContent || '').slice(0, 600))}</pre></div>`;
  } else if (hasErr) {
    body = `<pre class="gpt-term-out" data-gpt-no-copy="1"><code>${esc(String(a.detail).slice(0, 400))}</code></pre>`;
  }

  const metaBits = [sum.meta, sum.label].filter(Boolean).join(' · ');
  const eye = a.url
    ? `<button type="button" class="gpt-canvas-eye gpt-canvas-trigger" data-mode="file" data-src="${esc(a.url)}" data-title="${esc(a.label || a.target || '')}" title="Preview">${EYE_SVG}</button>`
    : '';

  const summaryInner = `
    <span class="gpt-agent-step-dot"></span>
    <span class="gpt-agent-step-verb">${esc(sum.verb)}</span>
    <span class="gpt-agent-step-fade">${esc(metaBits)}</span>
    ${eye}
    ${hasBody ? `<span class="gpt-agent-step-chevron-fade">▾</span>` : ''}`;

  if (!hasBody) {
    return `<div class="gpt-agent-step-wrapper">
      <div class="gpt-agent-step ${statusClass}">
        ${summaryInner}
      </div>
    </div>`;
  }

  // Lists / trees: collapsed by default. Web search: open while live (opts.forceOpenLists)
  const isWeb = a.kind === 'web' || a.fcName === 'web_search';
  const isStatus = a.kind === 'status' || a.fcName === 'rate_limit_retry' || a.fcName === 'api_key_failover';
  const forceClosed = hasEntries && !opts.forceOpenLists && !opts.openWeb;
  // Rate-limit row: open while running so reason is visible
  const isOpen = isStatus
    ? (a.status === 'running' || a.status === 'RUNNING' || open)
    : (open && !forceClosed);

  return `<details class="gpt-agent-collapse ${statusClass}"${isOpen ? ' open' : ''}>
    <summary class="gpt-agent-step ${statusClass}">
      ${summaryInner}
    </summary>
    <div class="gpt-agent-collapse-body">${body}</div>
  </details>`;
}

/**
 * Full log for history — outer Grok shell "Worked for Ns"
 */
export function renderAgentLogHtml(actions, { openAll = false, durationSec = null } = {}) {
  if (!Array.isArray(actions) || !actions.length) return '';
  const visible = actions.filter(a => !isInternalAction(a));
  if (!visible.length) return '';
  const rows = visible.map(a => buildActionDetailsHtml(a, { open: openAll })).join('');
  const sec = durationSec != null ? durationSec : (actions._durationSec != null ? actions._durationSec : null);
  const title = sec != null
    ? formatWorkedDuration(sec)
    : `Worked · ${visible.length} step${visible.length === 1 ? '' : 's'}`;
  return `<details class="gpt-agent-work">
    <summary class="gpt-agent-work-summary">
      <span class="gpt-agent-work-dot"></span>
      <span class="gpt-agent-work-title">${escapeHtml(title)}</span>
      <span class="gpt-agent-step-chevron-fade">▾</span>
    </summary>
    <div class="gpt-agent-log">${rows}</div>
  </details>`;
}

export function collapseAgentLog(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll?.('details.gpt-agent-collapse').forEach(d => { d.open = false; });
  rootEl.querySelectorAll?.('details.gpt-agent-work').forEach(d => { d.open = false; });
}

export const AGENT_COLLAPSE_CSS = `
.gpt-agent-work{margin:8px 0 10px;border:none;background:transparent}
.gpt-agent-work>summary{list-style:none;cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;font-size:12.5px;color:var(--secondary-text-color,#9aa)}
.gpt-agent-work>summary::-webkit-details-marker{display:none}
.gpt-agent-work>summary:hover{background:rgba(125,125,125,.08)}
.gpt-agent-work-dot{width:7px;height:7px;border-radius:50%;background:#5b8ef4;flex-shrink:0;opacity:.85}
.gpt-agent-work[open]>.gpt-agent-work-summary .gpt-agent-work-dot{background:#3fb97f}
.gpt-agent-work-title{flex:1;font-weight:500;opacity:.9}
.gpt-agent-log{margin:4px 0 0;padding-left:10px;border-left:2px solid rgba(125,125,125,.2);display:flex;flex-direction:column;gap:1px}
.gpt-agent-collapse{margin:1px 0 2px;border:none;background:transparent}
.gpt-agent-collapse>summary{list-style:none;cursor:pointer;user-select:none}
.gpt-agent-collapse>summary::-webkit-details-marker{display:none}
.gpt-agent-collapse-body{margin:2px 0 8px 14px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.07);background:rgba(12,12,18,.55);max-height:220px;overflow:auto;scrollbar-width:thin}
.gpt-agent-step{display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:5px;font-size:12.5px;line-height:1.45}
.gpt-agent-step-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;background:#888}
.gpt-agent-step.is-success .gpt-agent-step-dot{background:#3fb97f}
.gpt-agent-step.is-error .gpt-agent-step-dot{background:#e5605a}
.gpt-agent-step-verb{color:var(--primary-text-color);font-weight:600;white-space:nowrap;flex-shrink:0}
.gpt-agent-step-fade{flex:1;min-width:0;color:var(--secondary-text-color,#888);opacity:.72;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400}
.gpt-agent-step-chevron-fade{flex-shrink:0;opacity:.4;font-size:11px;transition:transform .15s ease}
.gpt-agent-collapse[open]>summary .gpt-agent-step-chevron-fade,
.gpt-agent-work[open]>.gpt-agent-work-summary .gpt-agent-step-chevron-fade{transform:rotate(-180deg);opacity:.7}
.gpt-canvas-eye{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:6px;background:transparent;color:var(--secondary-text-color,#9aa);cursor:pointer;padding:0;flex-shrink:0;opacity:.7}
.gpt-canvas-eye:hover{opacity:1;background:rgba(125,125,125,.12);color:var(--primary-text-color,#eee)}
.gpt-file-tree{display:flex;flex-direction:column;gap:1px}
.gpt-file-row{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:4px;font-size:11.5px;color:var(--secondary-text-color,#aaa)}
.gpt-file-row.is-dir{color:var(--primary-text-color,#ddd)}
.gpt-file-row .gpt-fi{flex-shrink:0;opacity:.7}
.gpt-file-name{font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gpt-agent-diff-body{display:grid;gap:6px}
.gpt-diff-old{margin:0;opacity:.7;font-size:11px;max-height:100px;overflow:auto}
.gpt-diff-new{margin:0;font-size:11px;max-height:100px;overflow:auto;border-left:2px solid #3fb97f;padding-left:6px}
`;
