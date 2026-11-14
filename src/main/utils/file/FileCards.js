/**
 * FileCards — same structure as live good-style response:
 *
 *   <div class="gpt-diff-view">
 *     <div class="gpt-diff-header">
 *       <span class="gpt-diff-header-title">Edit · script.js</span>
 *       <span class="gpt-diff-header-stats"><span class="add">+20</span><span class="rem">−7</span></span>
 *     </div>
 *     <div class="gpt-diff-content">…ln + sign + text…</div>
 *   </div>
 *
 * Header click = collapse only (NOT canvas open).
 * Styles only in response.css.
 */

import { diffView } from './DiffUtil.js';

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function cardId(path) {
  return 'lf-' + String(path).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function fileName(path) {
  const p = String(path || '');
  return p.split('/').pop() || p || 'file';
}

/** Kind label matching LiveChatUI good style. */
function kindTitle({ kind, path, streaming, failed, verb }) {
  const name = fileName(path);
  if (streaming) return `Writing · ${name}`;
  if (failed) return `Failed · ${name}`;
  const v = String(verb || '');
  if (/patch|search_replace|replace/i.test(v)) return `Edit · ${name}`;
  if (/line.?edit|edit_file_lines/i.test(v)) return `Line edits · ${name}`;
  if (kind === 'new') return `Update file · ${name}`;
  if (kind === 'rewrite') return `Update · ${name}`;
  if (kind === 'patch') return `Edit · ${name}`;
  return name;
}

function statsHtml(added, removed) {
  const a = added > 0 ? `<span class="add">+${added}</span>` : '';
  const r = removed > 0 ? `<span class="rem">−${removed}</span>` : '';
  if (!a && !r) return '';
  return `<span class="gpt-diff-header-stats">${a}${r}</span>`;
}

const EYE_SVG = `<svg class="gpt-diff-eye-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

function headerInnerHtml({ kind, path, streaming, failed, verb, added, removed, url }) {
  const title = kindTitle({ kind, path, streaming, failed, verb });
  const eye = url
    ? `<button type="button" class="gpt-diff-eye gpt-canvas-trigger" data-mode="file" data-src="${esc(url)}" data-title="${esc(path || '')}" title="Open in canvas">${EYE_SVG}</button>`
    : '';
  return `${eye}<span class="gpt-diff-header-title">${esc(title)}</span>${statsHtml(added || 0, removed || 0)}`;
}

function bindHeaderCollapse(view) {
  if (!view || view._collapseBound) return;
  view._collapseBound = true;
  const header = view.querySelector('.gpt-diff-header');
  if (!header) return;
  header.style.cursor = 'pointer';
  // Never canvas-trigger on header — only collapse
  header.classList.remove('gpt-canvas-trigger');
  header.removeAttribute('data-mode');
  header.removeAttribute('data-src');
  header.removeAttribute('data-title');
  header.addEventListener('click', (e) => {
    // Eye button opens canvas — do not collapse
    if (e.target.closest('.gpt-diff-eye, .gpt-live-apply-btn')) return;
    e.preventDefault();
    e.stopPropagation();
    view.classList.toggle('is-collapsed');
  });
}

export function bindDiffViewCollapse(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('.gpt-diff-view').forEach(bindHeaderCollapse);
}

export function fileCardHtml(entry) {
  const path = entry.path || entry.label || entry.target || '';
  const content = entry.content != null ? entry.content : (entry.newContent || '');
  const oldContent = entry.oldContent != null ? entry.oldContent : (entry.oldText || '');
  const isError = entry.status === 'error' || entry.failed;
  const applied = entry.status === 'success' || entry.applied || (!isError && entry.status !== 'pending');
  const streaming = !!entry.streaming;
  const dv = diffView(oldContent, content);
  const stateClass = [
    isError ? 'is-failed' : '',
    streaming ? 'is-streaming' : '',
    applied && !isError ? 'is-applied' : ''
  ].filter(Boolean).join(' ');

  const header = headerInnerHtml({
    kind: dv.kind,
    path,
    streaming,
    failed: isError,
    verb: entry.verb || entry.fcName || '',
    added: dv.added,
    removed: dv.removed,
    url: entry.url || ''
  });

  return `<div class="gpt-diff-view ${stateClass}" id="${esc(cardId(path))}" data-path="${esc(path)}"${applied && !isError ? ' data-applied="1"' : ''}>
  <div class="gpt-diff-header">${header}</div>
  <div class="gpt-diff-content" data-gpt-no-copy="1">${dv.html}</div>
  <button type="button" class="gpt-live-apply-btn" disabled style="display:none">Apply</button>
</div>`;
}

export function fileCardsGroupHtml(actions) {
  if (!actions || !actions.length) return '';
  const entries = actions.map(a => ({
    path: a.path || a.label || a.target || '',
    content: a.newContent != null ? a.newContent : a.content,
    oldContent: a.oldContent != null ? a.oldContent : a.oldText,
    status: a.status === 'error' ? 'error' : 'success',
    url: a.url || null,
    verb: a.verb || a.fcName || '',
    fcName: a.fcName || '',
    streaming: false,
    applied: a.status !== 'error'
  }));
  return entries.map(fileCardHtml).join('');
}

function attachAutoScroll(bodyEl) {
  if (!bodyEl || bodyEl._autoScrollBound) return;
  bodyEl._autoScrollBound = true;
  bodyEl._autoScroll = true;
  bodyEl.addEventListener('scroll', () => {
    const nearBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 28;
    bodyEl._autoScroll = nearBottom;
  });
}

function autoScrollToBottom(bodyEl) {
  if (bodyEl && bodyEl._autoScroll !== false) bodyEl.scrollTop = bodyEl.scrollHeight;
}

/** File-cards always after agent-log — never above game/ / Read steps. */
export function ensureGroup(lastMsg, { showApplyAll = false } = {}) {
  let root = lastMsg.querySelector(':scope > .gpt-file-cards');
  if (root) {
    const allBtn = root.querySelector('.gpt-live-apply-all-btn');
    if (allBtn) allBtn.style.display = showApplyAll ? '' : 'none';
    const log = lastMsg.querySelector(':scope > .gpt-agent-log');
    if (log && (root.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      log.after(root);
    }
    return root;
  }
  root = document.createElement('div');
  root.className = 'gpt-file-cards';
  const allBtnStyle = showApplyAll ? '' : 'display:none';
  root.innerHTML = `
    <button type="button" class="gpt-live-apply-all-btn" disabled style="${allBtnStyle}">Apply all</button>
    <div class="gpt-file-cards-list"></div>
  `;
  const log = lastMsg.querySelector(':scope > .gpt-agent-log');
  const holder = lastMsg.querySelector(':scope > .gpt-message-inner-holder');
  if (log) log.after(root);
  else if (holder) lastMsg.insertBefore(root, holder);
  else lastMsg.appendChild(root);
  return root;
}

export function getOrCreateCard(root, path, { showApplyBtn = false } = {}) {
  const list = root.querySelector('.gpt-file-cards-list') || root;
  const id = cardId(path);
  let view = list.querySelector('#' + CSS.escape(id));
  if (!view) {
    view = document.createElement('div');
    view.className = 'gpt-diff-view';
    view.id = id;
    view.dataset.path = path || '';
    view.innerHTML = `
      <div class="gpt-diff-header"></div>
      <div class="gpt-diff-content" data-gpt-no-copy="1"></div>
      <button type="button" class="gpt-live-apply-btn" disabled style="${showApplyBtn ? '' : 'display:none'}">Apply</button>
    `;
    list.appendChild(view);
    bindHeaderCollapse(view);
    attachAutoScroll(view.querySelector('.gpt-diff-content'));
  }
  return view;
}

export function paintCard(view, { path, content, oldContent, streaming, url, verb }) {
  const dv = diffView(oldContent || '', content || '');
  view.dataset.path = path || '';
  if (url) view.dataset.url = url;
  const header = view.querySelector('.gpt-diff-header');
  if (header) {
    const failed = view.classList.contains('is-failed');
    header.innerHTML = headerInnerHtml({
      kind: dv.kind,
      path,
      streaming,
      failed,
      verb: verb || '',
      added: dv.added,
      removed: dv.removed,
      url: url || view.dataset.url || ''
    });
    header.classList.remove('gpt-canvas-trigger');
    header.removeAttribute('data-mode');
    header.removeAttribute('data-src');
    header.removeAttribute('data-title');
  }
  view.classList.toggle('is-streaming', !!streaming);
  const body = view.querySelector('.gpt-diff-content');
  if (body) {
    body.innerHTML = dv.html;
    if (!view.classList.contains('is-collapsed')) autoScrollToBottom(body);
  }
  return dv;
}

export function markCurrent(root, view, isCurrent) {
  const list = root.querySelector('.gpt-file-cards-list') || root;
  Array.from(list.querySelectorAll('.gpt-diff-view')).forEach(d => {
    d.classList.remove('is-current');
    if (d !== view) d.classList.add('is-collapsed');
  });
  if (isCurrent) {
    view.classList.add('is-current');
    view.classList.remove('is-collapsed');
  }
}

export function updateGroupStats(root) {
  const list = root.querySelector('.gpt-file-cards-list') || root;
  const cards = Array.from(list.querySelectorAll('.gpt-diff-view'));
  const total = cards.length;
  const applied = cards.filter(d => d.dataset.applied === '1').length;
  const readyBtns = cards.filter(d => {
    const btn = d.querySelector('.gpt-live-apply-btn');
    return btn && !btn.disabled && d.dataset.applied !== '1' && btn.style.display !== 'none';
  });
  const allBtn = root.querySelector('.gpt-live-apply-all-btn');
  if (allBtn) {
    if (total > 0 && applied >= total) {
      allBtn.disabled = true;
      allBtn.textContent = 'All applied';
    } else {
      allBtn.disabled = readyBtns.length === 0;
      allBtn.textContent = 'Apply all';
    }
  }
}

export function wireApplyButton(view, onClick) {
  const btn = view.querySelector('.gpt-live-apply-btn');
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;
    onClick();
  });
}

export function markApplying(view) {
  const btn = view.querySelector('.gpt-live-apply-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const header = view.querySelector('.gpt-diff-header');
  if (header && view.dataset.applied !== '1') {
    const path = view.dataset.path || '';
    header.innerHTML = headerInnerHtml({
      kind: 'patch',
      path,
      streaming: true,
      failed: false,
      added: 0,
      removed: 0
    });
  }
}

export function markApplied(view, ok, err) {
  view.dataset.applied = ok ? '1' : '0';
  const btn = view.querySelector('.gpt-live-apply-btn');
  if (btn) { btn.textContent = ok ? 'Applied ✓' : 'Retry'; btn.disabled = ok; }
  view.classList.remove('is-streaming');
  view.classList.toggle('is-applied', !!ok);
  view.classList.toggle('is-failed', !ok);
  const header = view.querySelector('.gpt-diff-header');
  if (header) {
    const path = view.dataset.path || '';
    const statsEl = header.querySelector('.gpt-diff-header-stats');
    const statsKeep = statsEl ? statsEl.outerHTML : '';
    const title = ok ? `Edit · ${fileName(path)}` : `Failed · ${fileName(path)}`;
    const url = view.dataset.url || '';
    const eye = url
      ? `<button type="button" class="gpt-diff-eye gpt-canvas-trigger" data-mode="file" data-src="${esc(url)}" data-title="${esc(path)}" title="Open in canvas">${EYE_SVG}</button>`
      : '';
    header.innerHTML = `${eye}<span class="gpt-diff-header-title">${esc(title)}</span>${statsKeep}`;
  }
}

export function upsertLiveFileCard(app, file, { isCurrent = false, streaming = false } = {}) {
  const lastMsg = app.chatBox?.querySelector('.assistant-message:last-child');
  if (!lastMsg || !file?.path) return;
  const root = ensureGroup(lastMsg);
  const view = getOrCreateCard(root, file.path);
  paintCard(view, {
    path: file.path,
    content: file.content,
    oldContent: file.oldContent,
    streaming,
    url: file.url,
    verb: file.verb || file.fcName || ''
  });
  markCurrent(root, view, isCurrent);
  updateGroupStats(root);
}
