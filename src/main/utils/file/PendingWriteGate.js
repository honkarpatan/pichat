// src/main/utils/file/PendingWriteGate.js
//
// Disk write + permission gate. UI now lives INLINE in the current turn's
// parts timeline (app._currentTurn.parts / .renderer) — no more separate
// ".gpt-file-cards" group bolted on below the agent log. A file confirm
// card appears exactly where it happened chronologically, same as every
// other part.
//
// Falls back to a silent (no-UI) write if there's no active turn (e.g.
// called outside the normal ChatHandler.sendMessageToApi flow) — writes
// still happen, just nothing paints, so callers never hang.

import { resolveProjectPath, applyFileBlocks, parseFileBlocks } from './FileBlockApplier.js';
import { readFile } from './fileOperations.js';
import { parseReplaceBlocks } from '../agent/AgentDualPipeline.js';
import { upsertLiveFileCard } from './FileCards.js';
import { PART_STATUS, upsertFilePart } from '../message/MessagePart.js';
import { paintUpsertResult } from '../message/PartsRenderer.js';

export { upsertLiveFileCard };

const TAG = '[PendingWriteGate]';

function lineCount(s) {
  if (!s) return 0;
  return String(s).split('\n').length;
}

function diffStats(oldText, newText) {
  const o = lineCount(oldText);
  const n = lineCount(newText);
  if (!oldText) return { added: n, removed: 0 };
  return { added: n, removed: o };
}

/**
 * Paint/patch a file part in the current turn's timeline. Returns the
 * rendered element, or null if there's no active turn (write still
 * proceeds — this is purely the visual side).
 * Uses paintUpsertResult so any preceding STREAMING text part that was
 * sealed by upsertFilePart gets markdown-repainted (not left as raw text).
 */
export function paintFilePart(app, data) {
  const turn = app?._currentTurn;
  if (!turn) return null;
  const result = upsertFilePart(turn.parts, { id: `file-${data.path}`, ...data });
  return paintUpsertResult(turn, result);
}

export function setTurnStatus(app, text) {
  try {
    const turn = app?._currentTurn;
    if (turn && app.chatHandler && typeof app.chatHandler._setTurnStatus === 'function') {
      app.chatHandler._setTurnStatus(turn, text);
    }
  } catch (_) {}
}

/**
 * Split markdown into full-file blocks vs replace blocks.
 * Body with @@@OLD/@@@NEW is NEVER written as raw file content.
 */
export function classifyWritePayload(markdown) {
  const replaces = parseReplaceBlocks(markdown) || [];
  const files = parseFileBlocks(markdown).filter(b => {
    const c = b.content || '';
    if (/@@@OLD|<<<<<<<\s*OLD/i.test(c) && /@@@NEW|=======|>>>>>>>/i.test(c)) {
      const m = c.match(/@@@OLD\s*\n([\s\S]*?)\n@@@NEW\s*\n([\s\S]*)$/i)
        || c.match(/<<<<<<<\s*OLD\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)(?:\n>>>>>>>|$)/i);
      if (m) {
        replaces.push({ path: b.path, oldText: m[1], newText: m[2] });
        return false;
      }
    }
    return true;
  });
  return { files, replaces };
}

export async function buildPendingEntries(markdown) {
  const { files, replaces } = classifyWritePayload(markdown);
  const pending = [];

  for (const r of replaces) {
    pending.push({
      kind: 'replace',
      path: r.path,
      oldText: r.oldText,
      newText: r.newText,
      lang: '',
      ...diffStats(r.oldText, r.newText)
    });
  }

  for (const f of files) {
    let oldText = '';
    try {
      const resolved = await resolveProjectPath(f.path);
      if (!resolved.error && resolved.fullPath) {
        const res = await readFile(resolved.fullPath);
        if (res != null) oldText = typeof res === 'string' ? res : (res.content || res.data || '');
      }
    } catch (_) {}
    const stats = diffStats(oldText, f.content);
    pending.push({
      kind: oldText ? 'update' : 'create',
      path: f.path,
      content: f.content,
      oldText,
      lang: f.lang,
      ...stats
    });
  }

  return pending;
}

async function performWrite(entry) {
  const oldSnap = entry.oldText != null ? entry.oldText : '';
  if (entry.kind === 'replace') {
    const { ToolRegistry } = await import('../../core/tools/ToolRegistry.js');
    let path = entry.path;
    if (!path.startsWith('content://')) {
      const resolved = await resolveProjectPath(path);
      if (resolved.error) return { success: false, path: entry.path, error: resolved.error };
      path = resolved.fullPath;
    }
    const toolRes = await ToolRegistry.executeTool({
      name: 'search_replace_edit',
      args: { path, edits: [{ search: entry.oldText, replace: entry.newText }] },
      id: `live-rep-${Date.now()}`
    });
    const ok = toolRes?.success !== false && !toolRes?.error;
    return { success: ok, path: entry.path, error: toolRes?.error, url: toolRes?.url };
  }

  const lang = entry.lang || '';
  const md = '```' + lang + ' file="' + entry.path + '"\n' + entry.content + '\n```';
  const result = await applyFileBlocks(md);
  const row = result.applied?.[0];
  const ok = !!(row && row.success);
  if (ok && oldSnap != null) {
    try {
      const { UndoStore } = await import('../editor/UndoStore.js');
      const app = window.gptApp || window.app;
      if (app) UndoStore.push(app, { path: entry.path, oldContent: oldSnap, newContent: entry.content, url: row?.url });
    } catch (_) {}
  }
  return {
    success: ok,
    path: entry.path,
    error: row?.error,
    url: row?.url
  };
}

function entryToPartData(entry) {
  const isReplace = entry.kind === 'replace';
  return {
    path: entry.path,
    oldContent: entry.oldText || '',
    newContent: isReplace ? entry.newText : entry.content,
    lang: entry.lang,
    fcName: isReplace ? 'search_replace_edit' : 'create_or_update_file'
  };
}

/**
 * Write all pending entries immediately, painting Writing… → Saved in place
 * on the same timeline slot for each path.
 */
export async function autoApplyPending(app, pending, { onApplied } = {}) {
  if (!pending || !pending.length) return { applied: 0, pending: 0, results: [] };
  const results = [];

  for (const entry of pending) {
    if (entry._applied) continue;
    entry._applied = true;

    paintFilePart(app, { ...entryToPartData(entry), verb: 'Writing', status: PART_STATUS.STREAMING });

    const res = await performWrite(entry);
    res.oldContent = entry.oldText;
    res.newContent = entry.kind === 'replace' ? entry.newText : entry.content;

    paintFilePart(app, {
      ...entryToPartData(entry),
      verb: res.success ? 'Saved' : 'Save failed',
      status: res.success ? PART_STATUS.SAVED : PART_STATUS.ERROR
    });

    results.push(res);
    onApplied?.(res);
  }

  return {
    applied: results.filter(r => r.success).length,
    pending: pending.length,
    results
  };
}

/**
 * One file at a time: paint pending card + Reject/Accept buttons appended
 * onto the SAME timeline element. Accept → write → repaint saved/error →
 * next file. Reject → repaint rejected → next file.
 */
export function attachApplyControls(app, pending, { onApplied } = {}) {
  return new Promise((resolve) => {
    if (!pending || !pending.length) {
      resolve({ applied: 0, pending: 0, results: [] });
      return;
    }

    const results = [];
    let index = 0;

    const showNext = () => {
      if (index >= pending.length) {
        setTurnStatus(app, null);
        resolve({ applied: results.filter(r => r.success).length, pending: pending.length, results });
        return;
      }

      const entry = pending[index];
      const el = paintFilePart(app, { ...entryToPartData(entry), verb: 'Reviewing', status: PART_STATUS.STREAMING });

      if (!el) {
        // No active turn to render a confirm card into — write silently,
        // never leave the caller waiting forever on an invisible prompt.
        performWrite(entry).then((res) => {
          res.oldContent = entry.oldText;
          res.newContent = entry.kind === 'replace' ? entry.newText : entry.content;
          results.push(res);
          onApplied?.(res);
          index++;
          showNext();
        });
        return;
      }

      el.classList.add('is-confirming');
      try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}
      setTurnStatus(app, `File ${index + 1} of ${pending.length} — Accept to write, Reject to skip`);

      let actions = el.querySelector('.gpt-card-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'gpt-card-actions';
        el.appendChild(actions);
      }
      actions.innerHTML = `
        <button type="button" class="gpt-btn-reject">Reject</button>
        <button type="button" class="gpt-btn-accept">Accept</button>
      `;

      const finishOne = async (accepted) => {
        actions.style.pointerEvents = 'none';
        let res;
        if (accepted) {
          paintFilePart(app, { ...entryToPartData(entry), verb: 'Writing', status: PART_STATUS.STREAMING });
          try {
            res = await performWrite(entry);
            res.oldContent = entry.oldText;
            res.newContent = entry.kind === 'replace' ? entry.newText : entry.content;
            entry._applied = !!res.success;
            paintFilePart(app, {
              ...entryToPartData(entry),
              verb: res.success ? 'Saved' : 'Save failed',
              status: res.success ? PART_STATUS.SAVED : PART_STATUS.ERROR
            });
            if (typeof window.toast === 'function') {
              window.toast(res.success ? 'Saved ' + (entry.path || '').split('/').pop() : (res.error || 'Write failed'), res.success ? 1500 : 2000);
            }
          } catch (err) {
            res = { success: false, path: entry.path, error: err?.message };
            paintFilePart(app, { ...entryToPartData(entry), verb: 'Save failed', status: PART_STATUS.ERROR });
          }
        } else {
          entry._rejected = true;
          res = { success: false, path: entry.path, rejected: true };
          paintFilePart(app, { ...entryToPartData(entry), verb: 'Rejected', status: PART_STATUS.REJECTED });
        }
        results.push(res);
        onApplied?.(res);
        index++;
        setTimeout(showNext, 180);
      };

      actions.querySelector('.gpt-btn-accept').onclick = (e) => { e.preventDefault(); e.stopPropagation(); finishOne(true); };
      actions.querySelector('.gpt-btn-reject').onclick = (e) => { e.preventDefault(); e.stopPropagation(); finishOne(false); };

      if (app.chatBox) app.chatBox.scrollTop = app.chatBox.scrollHeight;
    };

    showNext();
  });
}

export async function requestApplyMarkdown(app, markdown, { onApplied, autoApply = false } = {}) {
  const pending = await buildPendingEntries(markdown);
  if (!pending.length) return { applied: 0, pending: 0 };
  if (autoApply) return autoApplyPending(app, pending, { onApplied });
  return attachApplyControls(app, pending, { onApplied });
}