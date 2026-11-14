// src/main/utils/OpenCodeUI.js
//
// Exact Claude Code / OpenCode checklist templates. All icons come from the
// central icons module — no raw inline <svg> anywhere in this file anymore.
// Collapse toggle is an SVG chevron that rotates via CSS (.is-open), not
// unicode ∨/∧ text.

import { computeLineDiff, statsFromOps, collapseContext } from './file/DiffUtil.js';
import { icons } from '../../data/svg.js';

/** Key SVG for API key failover / Trying with… rows (not circle). */
export const ICON_KEY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;

/**
 * OC rail row expand mode from settings.
 * collapse | uncollapse | running | remember
 */
export function getOcRowCollapseMode(app) {
  try {
    const v = app?.settingsStore?.get?.('ocRowCollapseMode', null)
      ?? app?.settingsStore?.get?.('ocRowCollapseMode', 'running');
    const s = String(v || 'running').toLowerCase();
    if (s === 'collapse' || s === 'collapsed') return 'collapse';
    if (s === 'uncollapse' || s === 'expanded' || s === 'expand') return 'uncollapse';
    if (s === 'remember') return 'remember';
    return 'running'; // uncollapse when running
  } catch (_) {
    return 'running';
  }
}

/**
 * Resolve whether a tool/status/file row body should start open.
 * @param {{ mode?: string, key?: string, status?: string, userOpen?: Map, lastTouchedKey?: string, hasBody?: boolean, force?: boolean|null }} opts
 */
export function resolveOcRowOpen(opts = {}) {
  const mode = opts.mode || 'running';
  const key = opts.key;
  const status = String(opts.status || '');
  const running = status === 'running' || status === 'streaming';
  if (opts.force === true) return true;
  if (opts.force === false) return false;
  if (opts.userOpen && key != null && opts.userOpen.has(key)) {
    return !!opts.userOpen.get(key);
  }
  if (mode === 'uncollapse') return true;
  if (mode === 'collapse') return false;
  if (mode === 'remember') return false; // default closed; user toggles remembered in userOpen
  // running: open while active
  if (running) return true;
  return false;
}

import { coverageBarHtml, mergeRanges, looksLikeNonFileContent, rangesFromFullFileDiff } from './file/FileCoverage.js';

export function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ---------------------------------------------------------------- chevron (SVG, rotates)

export function chevronHtml(open) {
  return `<span class="gpt-oc-chevron${open ? ' is-open' : ''}">${icons.chevronRight}</span>`;
}

// ---------------------------------------------------------------- rail icon (type SVG — never a tick/check)
//
// Claude/OpenCode style: the rail shows WHAT the step is (search/edit/
// terminal/folder), not a green check when done. While running the same
// type icon keeps a soft pulse; error uses the x mark.

export function stepIconHtml(status, typeKey = null) {
  const running = status === 'running' || status === 'streaming';
  const err = status === 'error' || status === 'rejected';
  let svg = (typeKey && icons[typeKey]) ? icons[typeKey] : null;
  if (!svg && typeKey === 'key') svg = ICON_KEY_SVG;
  if (!svg) {
    if (err) svg = icons.x;
    else if (running && typeKey !== 'key') svg = icons.spinner;
    else if (typeKey === 'key') svg = ICON_KEY_SVG;
    else svg = icons.circle; // neutral, not icons.check
  }
  // Key rows keep key icon even while running (not spinner/circle)
  if (typeKey === 'key' && !err) svg = ICON_KEY_SVG;
  const cls = err ? 'is-error' : running ? 'is-running' : 'is-idle';
  return `<span class="gpt-oc-icon ${cls}">${svg}</span>`;
}

function typeIconHtml(key) {
  // Kept for plan/sub-row helpers; main tool/file rows use rail only
  if (!key || !icons[key]) return '';
  return `<span class="gpt-oc-type-icon">${icons[key]}</span>`;
}

// ---------------------------------------------------------------- verb/meta + icon per tool

export function toolSummary(part) {
  const fc = part.fcName || '';
  const label = part.label || part.target || '';
  const name = label.split('/').pop() || label;

  if (fc === 'web_search' || part.kind === 'web') {
    const running = part.status === 'running' || part.status === 'streaming';
    const failed = part.status === 'error';
    return {
      verb: running ? 'Searching web for' : failed ? 'Search failed' : 'Searched web for',
      meta: label || 'web',
      collapsible: !!(part.entries && part.entries.length),
      icon: 'search'
    };
  }
  if (fc === 'api_key_failover') {
    return {
      verb: part.verb || 'Trying with API key',
      meta: '',
      collapsible: !!part.detail,
      icon: 'key'
    };
  }
  if (fc === 'rate_limit_retry' || part.kind === 'status') {
    return {
      verb: part.verb || 'Retrying',
      meta: '',
      collapsible: !!part.detail,
      icon: 'clock'
    };
  }
  if (fc === 'thinking' || part.kind === 'thinking' || part.type === 'thinking') {
    const running = part.status === 'running' || part.status === 'streaming';
    const started = part.startedAt || part.createdAt || Date.now();
    const ended = part.endedAt || (running ? Date.now() : started);
    const sec = Math.max(0, (ended - started) / 1000);
    const secLabel = sec < 10 ? sec.toFixed(1) + 's' : Math.round(sec) + 's';
    const sim = part.simulated ? ' · simulated' : '';
    return {
      verb: running ? 'Thinking' : 'Thought',
      meta: running ? (part.simulated ? 'simulated' : '') : (secLabel + sim),
      collapsible: !!(part.detail || part.text || part.redactedData),
      icon: running ? null : 'circle'
    };
  }
  if (fc === 'read_file' || fc === 'read' || part.kind === 'file-coverage') {
    const ranges = Array.isArray(part.readRanges) ? part.readRanges : [];
    let meta = name;
    if (ranges.length) {
      const bits = ranges.slice(0, 3).map(r => `${r.start}–${r.end}`);
      meta = name + (bits.length ? ` · ${bits.join(', ')}` : '');
      if (ranges.length > 3) meta += '…';
    }
    return { verb: ranges.length > 1 ? 'Read' : (part.verb || 'Read'), meta, collapsible: !!part.detail, icon: 'fileRead' };
  }
  if (fc === 'list_directory' || part.kind === 'tree') {
    const n = Array.isArray(part.entries) ? part.entries.length : 0;
    return { verb: 'Listed directory', meta: n ? `${name || 'root'} · ${n} item${n === 1 ? '' : 's'}` : (name || 'root'), collapsible: n > 0, icon: 'folder' };
  }
  if (fc === 'list_open_project_folders') {
    const n = Array.isArray(part.entries) ? part.entries.length : 0;
    return { verb: 'Checked projects', meta: n ? `${n} open` : '', collapsible: n > 0, icon: 'folder' };
  }
  if (fc === 'create_file_tree') {
    return { verb: 'Created files', meta: name, collapsible: true, icon: 'folder' };
  }
  if (fc === 'run_shell_command' || fc === 'run_command' || fc === 'grep' || fc === 'glob' || part.kind === 'command') {
    const cmd = part.fcArgs?.command || part.label || part.target || '';
    return { verb: 'Ran command', meta: cmd, collapsible: !!part.detail, icon: 'terminal' };
  }
  if (fc === 'finish_task') {
    return { verb: 'Finished', meta: '', collapsible: false, icon: null };
  }
  if (fc === 'subagent') {
    const running = part.status === 'running' || part.status === 'streaming';
    // Prefer explicit verb from logger (Explore → Explored)
    let verb = part.verb || (running ? 'Explore' : 'Explored');
    if (running && /^Explored/i.test(verb)) verb = verb.replace(/^Explored/i, 'Explore');
    if (!running && /^Explore(?!d)/i.test(verb)) verb = verb.replace(/^Explore/i, 'Explored');
    return {
      verb,
      meta: label || '',
      collapsible: !!part.detail,
      icon: 'search'
    };
  }
  return { verb: part.verb || 'Ran', meta: label, collapsible: !!part.detail, icon: null };
}

export function fileSummary(part) {
  const name = (part.path || '').split('/').pop() || part.path || 'file';
  let verb = 'Edited';
  if (part.status === 'streaming' || part.status === 'running') verb = 'Writing';
  else if (part.status === 'error') verb = 'Edit failed';
  else if (part.status === 'rejected') verb = 'Rejected';
  else if (!part.oldContent) verb = 'Created';
  return { verb, name, icon: 'edit' };
}

// ---------------------------------------------------------------- entries body (list/tree/links)

export function entriesBodyHtml(entries) {
  const list = Array.isArray(entries) ? entries.slice(0, 60) : [];
  if (!list.length) return `<div class="gpt-oc-entries"><div class="gpt-oc-entry-empty">empty</div></div>`;
  const rows = list.map(e => {
    if (e.url || e.type === 'link') {
      const title = escapeHtml(e.name || e.title || e.url || 'Link');
      const url = escapeHtml(e.url || '');
      return `<div class="gpt-oc-entry is-link" data-url="${url}">
        <span class="gpt-oc-entry-icon">${icons.link}</span>
        <span class="gpt-oc-entry-name">${title}</span>
      </div>`;
    }
    const isDir = !!(e.isDirectory || e.type === 'directory');
    const iconHtml = isDir ? icons.folder : icons.fileRead;
    return `<div class="gpt-oc-entry ${isDir ? 'is-dir' : 'is-file'}">
      <span class="gpt-oc-entry-icon">${iconHtml}</span>
      <span class="gpt-oc-entry-name">${escapeHtml(e.name || '')}</span>
    </div>`;
  }).join('');
  return `<div class="gpt-oc-entries">${rows}</div>`;
}

export function commandBodyHtml(part) {
  const cmd = part.fcArgs?.command
    ? `<div class="gpt-oc-cmd-line"><span class="gpt-oc-cmd-prompt">$</span>${escapeHtml(String(part.fcArgs.command).slice(0, 220))}</div>`
    : '';
  const out = part.detail ? `<pre class="gpt-oc-cmd-out">${escapeHtml(String(part.detail).slice(0, 500))}</pre>` : '';
  return `<div class="gpt-oc-cmd">${cmd}${out}</div>`;
}

// ---------------------------------------------------------------- file coverage bar

function coverageBarForPart(part) {
  try {
    const reads = Array.isArray(part.readRanges) ? part.readRanges : [];
    let edits = Array.isArray(part.editRanges) ? part.editRanges : [];
    let adds = Array.isArray(part.addRanges) ? part.addRanges : [];
    let removes = Array.isArray(part.removeRanges) ? part.removeRanges : [];
    if (!adds.length && !removes.length && !edits.length &&
        part.oldContent != null && part.newContent != null) {
      try {
        const built = rangesFromFullFileDiff(part.oldContent, part.newContent);
        adds = built.addRanges || [];
        removes = built.removeRanges || [];
        edits = built.editRanges || [];
        if (!Number(part.fileTotalLines) && built.fileTotalLines) {
          part.fileTotalLines = built.fileTotalLines;
        }
      } catch (_) {
        const n = Math.max(1, String(part.newContent).split(/\r?\n/).length);
        edits = [{ start: 1, end: n }];
      }
    }
    if (!reads.length && !edits.length && !adds.length && !removes.length) return '';
    const total = Math.max(
      Number(part.fileTotalLines) || 0,
      ...reads.map(r => Number(r.end) || 0),
      ...edits.map(r => Number(r.end) || 0),
      ...adds.map(r => Number(r.end) || 0),
      ...removes.map(r => Number(r.end) || 0),
      1
    );
    return coverageBarHtml({
      totalLines: total,
      readRanges: reads,
      editRanges: edits,
      addRanges: adds,
      removeRanges: removes,
      mode: (adds.length || removes.length || edits.length) ? 'edit' : 'read'
    });
  } catch (_) {
    return '';
  }
}

// ---------------------------------------------------------------- single tool row

export function toolRowHtml(part, { open = false } = {}) {
  const sum = toolSummary(part);
  const isActive = part.status === 'running' || part.status === 'streaming';
  // Rate-limit status: expand while running so reason is visible
  // Open state comes from PartsRenderer + ocRowCollapseMode (do not force-open here)

  let body = '';
  if (Array.isArray(part.entries) && part.entries.length) body = entriesBodyHtml(part.entries);
  else if (part.kind === 'command' || part.fcName === 'run_shell_command') body = commandBodyHtml(part);
  else if (part.fcName === 'thinking' || part.kind === 'thinking') {
    const raw = String(part.detail || part.text || '').slice(0, 12000);
    const notice = part.simulated
      ? `<div class="gpt-oc-thinking-notice">This model has no native thinking channel — showing prompted reasoning (not API-level think).</div>`
      : '';
    // Markdown/HTML already prepared by caller in part.detailHtml, else escape
    const inner = part.detailHtml != null
      ? String(part.detailHtml)
      : escapeHtml(raw);
    body = `${notice}<div class="gpt-oc-thinking-body gpt-md" data-gpt-no-copy="1">${inner}</div>`;
  }
  else if (part.kind === 'status' || part.fcName === 'rate_limit_retry' || part.fcName === 'api_key_failover') {
    body = `<div class="gpt-status-reason" style="font-size:12px;opacity:0.75;padding:4px 2px;line-height:1.45;white-space:normal;">${escapeHtml(String(part.detail || '').slice(0, 1200))}</div>`;
  }
  else if (part.detail) body = `<pre class="gpt-oc-cmd-out" data-gpt-no-copy="1">${escapeHtml(String(part.detail).slice(0, 500))}</pre>`;

  const hasBody = !!body;
  const eye = part.url
    ? `<button type="button" class="gpt-oc-eye gpt-canvas-trigger" data-mode="file" data-src="${escapeHtml(part.url)}" data-title="${escapeHtml(sum.meta)}" title="Preview">${icons.eye}</button>`
    : '';

  return `<div class="gpt-oc-row-wrap gpt-oc-part" data-status="${part.status}">
    <div class="gpt-oc-rail"><span class="gpt-oc-rail-line"></span>${stepIconHtml(part.status, sum.icon)}</div>
    <div class="gpt-oc-row-main">
      <div class="gpt-oc-row${isActive ? ' is-active' : ''}"${hasBody ? ' data-toggle="1"' : ''}>
        <span class="gpt-oc-row-title">${escapeHtml(sum.verb)}</span>
        <span class="gpt-oc-row-meta">${escapeHtml(sum.meta)}</span>
        ${coverageBarForPart(part)}
        ${eye}
        ${hasBody ? chevronHtml(open) : ''}
      </div>
      ${hasBody ? `<div class="gpt-oc-row-body${open ? ' is-expanded' : ''}">${body}</div>` : ''}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- grouped web-search

export function searchSubRowHtml(part) {
  const q = part.label || part.target || 'web';
  return `<div class="gpt-oc-subrow" data-status="${part.status}">
    <span class="gpt-oc-subrow-icon">${icons.search}</span>
    <span class="gpt-oc-subrow-text"><span class="gpt-oc-subrow-verb">Searched web for</span> ${escapeHtml(q)}</span>
  </div>`;
}

export function searchGroupHtml(parts, { open } = {}) {
  const n = parts.length;
  if (n <= 1) return toolRowHtml(parts[0], { open: false });

  const anyRunning = parts.some(p => p.status === 'running' || p.status === 'streaming');
  const anyError = parts.some(p => p.status === 'error');
  const status = anyRunning ? 'running' : (anyError ? 'error' : 'done');
  const isOpen = !!open;

  return `<div class="gpt-oc-row-wrap gpt-oc-part gpt-oc-group" data-status="${status}">
    <div class="gpt-oc-rail"><span class="gpt-oc-rail-line"></span>${stepIconHtml(status, 'search')}</div>
    <div class="gpt-oc-row-main">
      <div class="gpt-oc-row${anyRunning ? ' is-active' : ''}" data-toggle="1">
        <span class="gpt-oc-row-title">Ran ${n} search${n === 1 ? '' : 'es'}</span>
        ${chevronHtml(isOpen)}
      </div>
      <div class="gpt-oc-row-body gpt-oc-group-body${isOpen ? ' is-expanded' : ''}">
        ${parts.map(searchSubRowHtml).join('')}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- file diff row

/**
 * Prefer fair patch view: if newText is a small replacement for start–end lines
 * of oldText, diff only that slice so UI is not "all deletes".
 */
function prepareDiffPair(oldText, newText, part) {
  let o = oldText != null ? String(oldText) : '';
  let n = newText != null ? String(newText) : '';
  if (looksLikeNonFileContent(o)) o = '';
  if (looksLikeNonFileContent(n)) n = '';
  const s = Number(part?.fcArgs?.start_line ?? part?.fcArgs?.startLine ?? part?.editRanges?.[0]?.start);
  const e = Number(part?.fcArgs?.end_line ?? part?.fcArgs?.endLine ?? part?.editRanges?.[0]?.end);
  if (o && n && Number.isFinite(s) && s >= 1) {
    const oldLines = o.split(/\r?\n/);
    const newLines = n.split(/\r?\n/);
    const end = Number.isFinite(e) && e >= s ? e : s;
    const span = end - s + 1;
    // new is full file (similar length) → normal full diff
    if (newLines.length >= Math.max(32, oldLines.length * 0.45)) {
      return { oldText: o, newText: n };
    }
    // new looks like replacement snippet for the line range
    if (newLines.length <= span * 4 + 40) {
      const slice = oldLines.slice(s - 1, end).join('\n');
      return { oldText: slice, newText: n };
    }
  }
  return { oldText: o, newText: n };
}

function diffRowsHtml(oldText, newText, maxRows = 400, part = null) {
  const pair = part ? prepareDiffPair(oldText, newText, part) : { oldText: oldText || '', newText: newText || '' };
  const ops = computeLineDiff(pair.oldText || '', pair.newText || '');
  // Only changed hunks + nearby context; ··· between distant regions
  let rows = collapseContext(ops, 2);
  let truncated = false;
  // Keep both adds and deletes when truncating (avoid "only −" UI)
  if (rows.length > maxRows) {
    // Preserve multi-hunk order: split on sep, budget rows per hunk
    const groups = [];
    let cur = [];
    for (const r of rows) {
      if (r.type === 'sep' || r.type === 'gap') {
        if (cur.length) groups.push(cur);
        groups.push([r]);
        cur = [];
      } else cur.push(r);
    }
    if (cur.length) groups.push(cur);
    const per = Math.max(12, Math.floor(maxRows / Math.max(1, groups.filter(g => g[0]?.type !== 'sep').length)));
    const out = [];
    for (const g of groups) {
      if (g[0]?.type === 'sep' || g[0]?.type === 'gap') {
        out.push(g[0]);
        continue;
      }
      if (g.length <= per) out.push(...g);
      else {
        out.push(...g.slice(0, Math.ceil(per / 2)));
        out.push({ type: 'sep', count: g.length - per });
        out.push(...g.slice(-(Math.floor(per / 2))));
      }
    }
    rows = out.length > maxRows ? out.slice(0, maxRows) : out;
    truncated = true;
  }
  const html = rows.map(o => {
    if (o.type === 'sep' || o.type === 'gap') {
      let label = '···';
      if (o.fromLn != null && o.toLn != null && o.toLn >= o.fromLn) {
        label = `··· lines ${o.fromLn}–${o.toLn} ···`;
      } else if (o.count > 0) {
        label = `··· ${o.count} unchanged line${o.count === 1 ? '' : 's'} ···`;
      }
      return `<div class="gpt-oc-diff-row is-sep"><span class="gpt-oc-diff-text">${escapeHtml(label)}</span></div>`;
    }
    const cls = o.type === 'add' ? 'is-add' : o.type === 'del' ? 'is-del' : 'is-ctx';
    const sign = o.type === 'add' ? '+' : o.type === 'del' ? '-' : ' ';
    const ln = o.type === 'del' ? (o.oldLn ?? '') : (o.newLn ?? o.oldLn ?? '');
    return `<div class="gpt-oc-diff-row ${cls}"><span class="gpt-oc-diff-ln">${ln}</span><span class="gpt-oc-diff-sign">${sign}</span><span class="gpt-oc-diff-text">${escapeHtml(o.text)}</span></div>`;
  }).join('');
  return { html, stats: statsFromOps(ops) };
}

/**
 * 🟢 FIX: `.gpt-card-actions` no longer carries inline `display:none`.
 * CSS rule `.gpt-card-actions:empty{display:none}` hides it while empty and
 * shows it automatically the instant PendingWriteGate/SequentialFileGate
 * fill it with Accept/Reject buttons — that inline style was the reason
 * confirm buttons never appeared (only the status-line text did).
 */
export function fileRowHtml(part, { open = false } = {}) {
  const sum = fileSummary(part);
  const { html, stats } = diffRowsHtml(part.oldContent, part.newContent, 400, part);
  const isActive = part.status === 'streaming' || part.status === 'running';
  const eye = part.url
    ? `<button type="button" class="gpt-oc-eye gpt-canvas-trigger" data-mode="file" data-src="${escapeHtml(part.url)}" data-title="${escapeHtml(part.path)}" title="Open">${icons.eye}</button>`
    : '';
  return `<div class="gpt-oc-row-wrap gpt-oc-part gpt-oc-file" data-status="${part.status}" data-path="${escapeHtml(part.path || '')}">
    <div class="gpt-oc-rail"><span class="gpt-oc-rail-line"></span>${stepIconHtml(part.status, sum.icon)}</div>
    <div class="gpt-oc-row-main">
      <div class="gpt-oc-row${isActive ? ' is-active' : ''}" data-toggle="1">
        <span class="gpt-oc-row-title">${escapeHtml(sum.verb)}</span>
        <span class="gpt-oc-row-meta gpt-oc-mono">${escapeHtml(sum.name)}</span>
        <span class="gpt-oc-diff-stats">${stats.added ? `<span class="add">+${stats.added}</span>` : ''}${stats.removed ? `<span class="rem">−${stats.removed}</span>` : ''}</span>
        ${coverageBarForPart(part)}
        ${eye}
        ${chevronHtml(open)}
      </div>
      <div class="gpt-oc-row-body gpt-oc-diff-body${open ? ' is-expanded' : ''}">${html}</div>
      <div class="gpt-card-actions"></div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- plan card (sticky + compact current+next)

function planItemIcon(status) {
  if (status === 'done') return icons.check;
  if (status === 'in_progress') return `<span class="gpt-oc-plan-spin">${icons.spinner}</span>`;
  return icons.circle;
}

function planItemRow(it) {
  const cls = it.status === 'done' ? 'is-done' : it.status === 'in_progress' ? 'is-active' : 'is-pending';
  return `<div class="gpt-oc-plan-item ${cls}">
    <span class="gpt-oc-plan-icon">${planItemIcon(it.status)}</span>
    <span class="gpt-oc-plan-text">${escapeHtml(it.text)}</span>
  </div>`;
}

/** Index of current step: in_progress, else first pending, else last */
function currentPlanIndex(items) {
  const list = Array.isArray(items) ? items : [];
  let i = list.findIndex(it => it.status === 'in_progress');
  if (i < 0) i = list.findIndex(it => it.status === 'pending');
  if (i < 0) i = Math.max(0, list.length - 1);
  return i;
}

/** Sticky compact: current + next (same .gpt-oc-plan-item structure) */
function planCompactItems(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const i = currentPlanIndex(list);
  return list.slice(i, i + 2);
}

export function planCardHtml(part) {
  const items = part.items || [];
  const isActive = part.status !== 'done';
  const doneCount = items.filter(i => i.status === 'done').length;
  const rows = items.map(planItemRow).join('');
  const compactRows = planCompactItems(items).map(planItemRow).join('');

  return `<div class="gpt-oc-row-wrap gpt-oc-part gpt-oc-plan-wrap${isActive ? ' is-sticky' : ''}" data-status="${part.status}">
    <div class="gpt-oc-plan-sentinel" aria-hidden="true"></div>
    <div class="gpt-oc-plan-sticky">
      <div class="gpt-oc-rail"><span class="gpt-oc-rail-line"></span>${stepIconHtml(part.status === 'done' ? 'done' : 'running', 'clipboard')}</div>
      <div class="gpt-oc-row-main">
        <div class="gpt-oc-plan-compact" data-plan-toggle="1" title="Tap to expand plan">
          <div class="gpt-oc-plan-compact-list">${compactRows}</div>
          <span class="gpt-oc-plan-compact-count">${doneCount}/${items.length}</span>
        </div>
        <div class="gpt-oc-plan-card" data-plan-toggle="1">
          <div class="gpt-oc-plan-header">
            <span class="gpt-oc-plan-header-icon">${icons.clipboard}</span>
            <span class="gpt-oc-plan-header-title">Plan</span>
            <span class="gpt-oc-plan-header-count">${doneCount}/${items.length}</span>
          </div>
          <div class="gpt-oc-plan-list">${rows}</div>
        </div>
      </div>
    </div>
  </div>`;
}


/**
 * Collapsible thinking / reasoning card (Plan 3 — Claude / OpenCode style).
 * @param {object} part  MessagePart type=thinking
 * @param {{ open?: boolean }} opts
 */
export function sanitizeThinkingDisplay(text) {
  let s = String(text || '');
  s = s.replace(/^\s*(here'?s|here is)\s+(a\s+)?thinking\s+process\s*:?\s*/i, '');
  s = s.replace(/^\s*thinking\s+process\s*:?\s*/i, '');
  s = s.replace(/^\s*<\s*think(?:ing)?\s*>\s*/i, '');
  s = s.replace(/\s*<\s*\/\s*think(?:ing)?\s*>\s*$/i, '');
  s = s.replace(/^\s*BEGIN_REASON\s*/i, '');
  s = s.replace(/\s*END_REASON\s*$/i, '');
  s = s.replace(/BEGIN_REASON|END_REASON/gi, '');
  return s.trim();
}

export function thinkingCardHtml(part, { open = false, renderMarkdown = null } = {}) {
  // Same OpenCode row chrome as search / read / run_command (inside Working shell)
  let detail = part?.redactedData && !String(part?.text || '').trim()
    ? 'Some internal reasoning was encrypted for safety. The answer below is unaffected.'
    : sanitizeThinkingDisplay(part?.text || part?.detail || '');
  let detailHtml = null;
  if (part?.redactedData && !String(part?.text || '').trim()) {
    detailHtml = escapeHtml(detail);
  } else if (typeof renderMarkdown === 'function') {
    try { detailHtml = renderMarkdown(detail); } catch (_) { detailHtml = escapeHtml(detail); }
  }
  const synthetic = {
    id: part?.id,
    type: 'tool',
    status: part?.status || 'done',
    fcName: 'thinking',
    kind: 'thinking',
    verb: undefined,
    target: '',
    label: '',
    detail: detail,
    detailHtml,
    text: part?.text,
    startedAt: part?.startedAt || part?.createdAt,
    endedAt: part?.endedAt,
    createdAt: part?.createdAt,
    redactedData: part?.redactedData,
    simulated: !!part?.simulated
  };
  return toolRowHtml(synthetic, { open });
}
