/**
 * HeldWrites — staged file changes the user hasn't Applied yet.
 * - Survives across tool steps in one turn
 * - Overlay for read_file so the model sees held content (no rewrite loops)
 * - Final Reject all / Apply all bar
 */

import { ensureGroup, getOrCreateCard, paintCard, markApplying, markApplied, updateGroupStats } from './FileCards.js';

const TAG = '[HeldWrites]';

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
}

function fileKey(p) {
  let n = normPath(p);
  const idx = n.lastIndexOf('::');
  if (idx !== -1) n = n.slice(idx + 2);
  n = n.replace(/^primary:/i, '').replace(/^\/+/, '');
  // full relative path so js/main.js ≠ css/main.css collision-free
  return n.toLowerCase() || 'file';
}

export class HeldWrites {
  static list(app) {
    if (!app._heldWritesMap) app._heldWritesMap = new Map();
    return app._heldWritesMap;
  }

  static clear(app) {
    app._heldWritesMap = new Map();
    app._heldPending = [];
    HeldWrites._notifySettled(app);
  }

  static _notifySettled(app) {
    const map = HeldWrites.list(app);
    const pending = [...map.values()].filter(e => e && !e._applied && !e._rejected);
    if (pending.length) return;
    const waiters = app._heldWaiters || [];
    app._heldWaiters = [];
    waiters.forEach(fn => { try { fn(); } catch (_) {} });
  }

  /** Resolve when user Apply all / Reject all / last single apply (no held left). */
  static waitUntilSettled(app, { timeoutMs = 0 } = {}) {
    const map = HeldWrites.list(app);
    const pending = [...map.values()].filter(e => e && !e._applied && !e._rejected);
    if (!pending.length) return Promise.resolve({ held: 0 });
    HeldWrites.showBatchUI(app);
    return new Promise((resolve) => {
      if (!app._heldWaiters) app._heldWaiters = [];
      const done = () => resolve({ held: 0 });
      app._heldWaiters.push(done);
      if (timeoutMs > 0) {
        setTimeout(() => {
          app._heldWaiters = (app._heldWaiters || []).filter(f => f !== done);
          resolve({ held: HeldWrites.list(app).size, timedOut: true });
        }, timeoutMs);
      }
    });
  }

  static pendingCount(app) {
    return [...HeldWrites.list(app).values()].filter(e => e && !e._applied && !e._rejected).length;
  }

  /**
   * Stage a write. Merges by path (latest wins).
   * @param {object} entry { path, content|newText, oldText, kind, url, fcName, fcArgs }
   */
  static stage(app, entry) {
    if (!entry || !entry.path) return;
    const map = HeldWrites.list(app);
    const key = fileKey(entry.path);
    const content = entry.content != null ? entry.content
      : (entry.newText != null ? entry.newText
        : (entry.newContent != null ? entry.newContent : null));
    if (content == null) {
      console.warn(TAG, 'stage without content', entry.path);
    }
    const prev = map.get(key) || {};
    const row = {
      path: entry.path,
      kind: entry.kind || prev.kind || 'update',
      content: content != null ? content : prev.content,
      oldText: entry.oldText != null ? entry.oldText : (entry.oldContent != null ? entry.oldContent : prev.oldText),
      url: entry.url || prev.url || null,
      fcName: entry.fcName || prev.fcName || '',
      fcArgs: entry.fcArgs || prev.fcArgs || null,
      _held: true,
      _applied: false,
      _rejected: false
    };
    map.set(key, row);
    app._heldPending = [...map.values()].filter(e => e && !e._applied && !e._rejected);
    console.log(TAG, 'staged', row.path, 'total=', map.size);
    return row;
  }

  static remove(app, path) {
    const map = HeldWrites.list(app);
    map.delete(fileKey(path));
    app._heldPending = [...map.values()].filter(e => e && !e._applied && !e._rejected);
    HeldWrites._notifySettled(app);
  }

  static get(app, path) {
    return HeldWrites.list(app).get(fileKey(path)) || null;
  }

  static has(app, path) {
    return HeldWrites.list(app).has(fileKey(path));
  }

  /** Overlay disk content with held version for model reads */
  static overlayContent(app, path, diskContent) {
    const row = HeldWrites.get(app, path);
    if (!row || row.content == null) return diskContent;
    return String(row.content);
  }

  /** System blurb so model does not rewrite held files */
  static contextNote(app) {
    const rows = [...HeldWrites.list(app).values()].filter(e => e && !e._applied && !e._rejected);
    if (!rows.length) return '';
    const lines = rows.map(r => {
      const name = (r.path || '').split('/').pop();
      const n = String(r.content || '').split('\n').length;
      return `- ${r.path || name} (${n} lines) — ALREADY staged. Do NOT rewrite this file again. Continue other work or finish_task.`;
    });
    return `[HELD WRITES — user has not applied yet; treat as already updated in this session]\n${lines.join('\n')}`;
  }

  /** Build entry from a mutating tool call (without executing). */
  static async fromToolCall(fc) {
    const args = fc?.args || {};
    const path = args.path || args.sourcePath || '';
    if (!path) return null;
    const name = fc.name;

    if (name === 'create_or_update_file' || name === 'update_active_file_content') {
      return {
        path,
        kind: 'update',
        content: args.content != null ? String(args.content) : '',
        oldText: '',
        fcName: name,
        fcArgs: args
      };
    }

    if (name === 'search_replace_edit') {
      let oldText = '';
      let content = '';
      try {
        const { readFile, resolveProjectPath } = await import('./fileOperations.js');
        // resolveProjectPath may live in FileBlockApplier
        let full = path;
        try {
          const { resolveProjectPath: rp } = await import('./FileBlockApplier.js');
          const r = await rp(path);
          if (r?.fullPath) full = r.fullPath;
        } catch (_) {}
        const res = await readFile(full);
        oldText = typeof res === 'string' ? res : (res?.content || res?.data || '');
        content = oldText;
        const edits = Array.isArray(args.edits) ? args.edits : [];
        for (const ed of edits) {
          const search = String(ed.search ?? ed.old ?? '');
          const replace = String(ed.replace ?? ed.new ?? '');
          if (!search) continue;
          if (content.includes(search)) content = content.replace(search, replace);
          else console.warn(TAG, 'search not found for hold', path);
        }
      } catch (e) {
        console.warn(TAG, 'fromToolCall patch', e);
        content = args.edits?.[0]?.replace || '';
      }
      return { path, kind: 'replace', content, oldText, newText: content, fcName: name, fcArgs: args };
    }

    if (name === 'edit_file_lines') {
      return {
        path,
        kind: 'update',
        content: '',
        fcName: name,
        fcArgs: args
      };
    }

    return { path, kind: 'update', content: '', fcName: name, fcArgs: args };
  }


  /** Paint held cards + Reject all / Apply all (never disappears while held remain). */
  static showBatchUI(app) {
    const rows = [...HeldWrites.list(app).values()].filter(
      e => e && !e._applied && !e._rejected && e.content != null && String(e.content).length > 0
    );
    const lastMsg = app.chatBox?.querySelector('.assistant-message:last-child')
      || app.chatBox?.querySelector('.assistant-message:last-of-type');
    if (!lastMsg) {
      console.warn(TAG, 'showBatchUI: no assistant message');
      return;
    }
    if (!rows.length) {
      lastMsg.querySelectorAll('.gpt-batch-actions').forEach(el => el.remove());
      return;
    }

    const root = ensureGroup(lastMsg, { showApplyAll: true });
    for (const entry of rows) {
      const det = getOrCreateCard(root, entry.path, { showApplyBtn: false });
      paintCard(det, {
        path: entry.path,
        content: entry.content,
        oldContent: entry.oldText || '',
        streaming: false,
        url: entry.url || null,
        verb: 'Held'
      });
      det.classList.add('is-held');
      det.dataset.path = entry.path;
      // paintCard may wipe buttons — always re-wire
      delete det.dataset.heldWired;
      const legacy = det.querySelector('.gpt-live-apply-btn');
      if (legacy) legacy.style.display = 'none';
      HeldWrites._wireCard(app, det, entry);
    }

    let bar = root.querySelector('.gpt-batch-actions');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'gpt-batch-actions';
      root.appendChild(bar);
    }
    bar.innerHTML = `
      <span class="gpt-batch-label">${rows.length} held — Apply or Reject to continue</span>
      <button type="button" class="gpt-btn-reject-all">Reject all</button>
      <button type="button" class="gpt-btn-apply-all">Apply all</button>
    `;
    bar.querySelector('.gpt-btn-reject-all').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      HeldWrites.clear(app);
      root.querySelectorAll('.gpt-diff-view.is-held').forEach(d => {
        d.classList.remove('is-held');
        d.classList.add('is-failed');
      });
      bar.remove();
    };
    bar.querySelector('.gpt-btn-apply-all').onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (bar.dataset.busy === '1') return;
      bar.dataset.busy = '1';
      const btn = bar.querySelector('.gpt-btn-apply-all');
      if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
      const list = [...HeldWrites.list(app).values()].filter(x => x && !x._applied && !x._rejected);
      let okN = 0, failN = 0;
      for (const entry of list) {
        const det = getOrCreateCard(root, entry.path, { showApplyBtn: false });
        markApplying(det);
        try {
          const res = await performWriteFromHeld(entry);
          if (res.success) {
            entry._applied = true;
            okN++;
            markApplied(det, true);
            det.classList.remove('is-held');
            HeldWrites.remove(app, entry.path);
          } else {
            failN++;
            markApplied(det, false, res.error);
            console.warn(TAG, 'apply failed', entry.path, res.error);
            if (typeof window.toast === 'function') window.toast(`Failed: ${(entry.path || '').split('/').pop()}`, 2500);
            // keep in store for Retry
            HeldWrites._wireCard(app, det, entry);
          }
        } catch (err) {
          failN++;
          console.error(TAG, 'apply threw', entry.path, err);
          markApplied(det, false, err?.message || String(err));
          HeldWrites._wireCard(app, det, entry);
        }
      }
      bar.dataset.busy = '0';
      updateGroupStats(root);
      if (typeof window.toast === 'function') {
        window.toast(failN ? `Applied ${okN}, failed ${failN}` : `Applied ${okN} file(s)`, 2500);
      }
      // refresh — keeps failures + bar if any left
      HeldWrites.showBatchUI(app);
    };
  }

  static _wireCard(app, det, entry) {
    if (!det) return;
    // Always refresh handlers (paintCard can wipe DOM)
    let actions = det.querySelector('.gpt-card-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'gpt-card-actions';
      det.appendChild(actions);
    }
    actions.innerHTML = `
      <button type="button" class="gpt-btn-reject">Reject</button>
      <button type="button" class="gpt-btn-accept">Apply</button>
    `;
    actions.style.display = '';
    det.dataset.heldWired = '1';
    const path = entry.path || det.dataset.path;
    actions.querySelector('.gpt-btn-accept').onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (det.dataset.applying === '1') return;
      det.dataset.applying = '1';
      const row = HeldWrites.get(app, path) || entry;
      if (!row || row._applied) { det.dataset.applying = '0'; return; }
      markApplying(det);
      try {
        const res = await performWriteFromHeld(row);
        if (res.success) {
          row._applied = true;
          markApplied(det, true);
          det.classList.remove('is-held');
          HeldWrites.remove(app, path);
          if (typeof window.toast === 'function') window.toast(`Saved ${(path || '').split('/').pop()}`, 1800);
        } else {
          markApplied(det, false, res.error);
          if (typeof window.toast === 'function') window.toast(res.error || 'Apply failed', 2500);
          // restore Apply for retry
          det.dataset.applying = '0';
          HeldWrites._wireCard(app, det, row);
          return;
        }
      } catch (err) {
        console.error(TAG, 'single apply', err);
        markApplied(det, false, err?.message || String(err));
        det.dataset.applying = '0';
        HeldWrites._wireCard(app, det, row);
        return;
      }
      det.dataset.applying = '0';
      HeldWrites.showBatchUI(app);
    };
    actions.querySelector('.gpt-btn-reject').onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      HeldWrites.remove(app, path);
      det.classList.remove('is-held');
      det.classList.add('is-failed');
      HeldWrites.showBatchUI(app);
    };
  }
}

/** Relative path for FileBlockApplier fences */
function toFencePath(p) {
  let s = String(p || '');
  if (!s) return 'file.txt';
  const idx = s.lastIndexOf('::');
  if (idx !== -1) s = s.slice(idx + 2);
  s = s.replace(/^primary:/i, '').replace(/^\/+/, '');
  // drop leading parent segments already in project root if full sdcard path
  s = s.replace(/^sdcard\//i, '');
  // Prefer path relative to workspace leaf when possible: Ay/game5/js/a.js → js/a.js if under game5
  return s.replace(/^\/+/, '') || 'file.txt';
}

export async function performWriteFromHeld(entry) {
  const { resolveProjectPath, applyFileBlocks } = await import('./FileBlockApplier.js');
  if (!entry) return { success: false, path: '', error: 'No entry' };
  const content = entry.content != null ? entry.content : entry.newText;
  if (content == null || String(content).length === 0) {
    return { success: false, path: entry.path, error: 'Empty content — nothing to write' };
  }

  if (entry.fcName === 'search_replace_edit' && entry.fcArgs?.edits) {
    const { ToolRegistry } = await import('../../core/tools/ToolRegistry.js');
    let path = entry.path;
    if (!path.startsWith('content://')) {
      const resolved = await resolveProjectPath(path);
      if (resolved.error) return { success: false, path: entry.path, error: resolved.error };
      path = resolved.fullPath;
    }
    const toolRes = await ToolRegistry.executeTool({
      name: 'search_replace_edit',
      args: { path, edits: entry.fcArgs.edits },
      id: `held-rep-${Date.now()}`
    });
    return {
      success: toolRes?.success !== false && !toolRes?.error,
      path: entry.path,
      error: toolRes?.error,
      url: toolRes?.url
    };
  }

  // Prefer relative path under project so getProjectFolder + create works
  let fencePath = toFencePath(entry.path);
  // If path includes workspace folder name twice, thin it: game5/js/x → js/x when project is game5
  try {
    const { getProjectFolder } = await import('./fileOperations.js');
    const proj = await getProjectFolder();
    const pname = (proj?.name || '').replace(/\/$/, '');
    if (pname && fencePath.startsWith(pname + '/')) {
      fencePath = fencePath.slice(pname.length + 1);
    }
    // Ay/game5/js/x with project game5 → js/x
    if (pname && fencePath.includes('/' + pname + '/')) {
      fencePath = fencePath.split('/' + pname + '/').pop();
    }
  } catch (_) {}

  const lang = (fencePath.split('.').pop() || '').slice(0, 12);
  const md = '```' + lang + ' file="' + fencePath.replace(/"/g, '') + '"\n' + content + '\n```';
  console.log(TAG, 'performWriteFromHeld', fencePath, 'bytes=', String(content).length);
  const result = await applyFileBlocks(md);
  const row = result.applied?.[0];
  if (!row || !row.success) {
    console.warn(TAG, 'applyFileBlocks result', result);
  }
  return {
    success: !!(row && row.success),
    path: entry.path,
    error: row?.error || (result.successCount ? null : 'Write failed'),
    url: row?.url
  };
}
