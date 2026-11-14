// src/main/utils/file/SequentialFileGate.js
//
// As each path-tagged fence completes during stream, paint ONE inline
// confirm card in the current turn's parts timeline (no separate
// ".gpt-file-cards" group anymore — see PendingWriteGate.js).

import { paintFilePart, setTurnStatus } from './PendingWriteGate.js';
import { buildPendingEntries } from './PendingWriteGate.js';
import { PART_STATUS } from '../message/MessagePart.js';

async function writeEntry(entry) {
  const { applyFileBlocks, resolveProjectPath } = await import('./FileBlockApplier.js');
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
      id: `seq-${Date.now()}`
    });
    return {
      success: toolRes?.success !== false && !toolRes?.error,
      path: entry.path,
      error: toolRes?.error,
      url: toolRes?.url,
      oldContent: entry.oldText,
      newContent: entry.newText
    };
  }
  const lang = entry.lang || '';
  const md = '```' + lang + ' file="' + entry.path + '"\n' + entry.content + '\n```';
  const result = await applyFileBlocks(md);
  const row = result.applied?.[0];
  return {
    success: !!(row && row.success),
    path: entry.path,
    error: row?.error,
    url: row?.url,
    oldContent: entry.oldText,
    newContent: entry.content
  };
}

const TAG = '[SequentialFileGate]';

export class SequentialFileGate {
  constructor(app, { onApplied, autoApply = false } = {}) {
    this.app = app;
    this.onApplied = onApplied;
    this.autoApply = autoApply;
    this.queue = [];
    this.seen = new Set();
    this.busy = false;
    this.streamDone = false;
    this.results = [];
    this._resolveAll = null;
    this._allPromise = new Promise((r) => { this._resolveAll = r; });
    this.totalEnqueued = 0;
    this.settled = 0;
    this._chain = Promise.resolve();
  }

  _key(path) {
    return String(path || '').replace(/\\/g, '/').toLowerCase();
  }

  /** Called when StreamFileCollector completes a fence — ordered, non-blocking for caller */
  enqueueFile(file) {
    this._chain = this._chain.then(() => this._enqueueFile(file)).catch(e => console.warn(TAG, e));
    return this._chain;
  }

  async _enqueueFile(file) {
    if (!file?.path || file.content == null) return;
    const k = this._key(file.path);
    if (this.seen.has(k)) {
      const q = this.queue.find(e => this._key(e.path) === k);
      if (q && !q._shown) q.content = file.content;
      return;
    }
    this.seen.add(k);
    this.totalEnqueued++;
    const entry = {
      kind: 'update',
      path: file.path,
      content: file.content,
      oldText: '',
      lang: file.lang || '',
      _shown: false,
      _done: false
    };
    try {
      const pending = await buildPendingEntries(
        '```' + (file.lang || '') + ' file="' + file.path + '"\n' + file.content + '\n```'
      );
      if (pending[0]) {
        entry.oldText = pending[0].oldText || '';
        entry.kind = pending[0].kind || entry.kind;
      }
    } catch (_) {}

    this.queue.push(entry);
    console.log(TAG, 'enqueued', entry.path, 'q=', this.queue.length);
    this._pump();
  }

  /** Stream finished generating */
  markStreamDone() {
    this.streamDone = true;
    this._pump();
    this._maybeFinish();
  }

  waitUntilIdle() {
    return this._allPromise;
  }

  _maybeFinish() {
    if (!this.streamDone) return;
    if (this.busy) return;
    if (this.queue.some(e => !e._done)) return;

    const ok = this.results.filter(r => r.success).length;
    const fail = this.results.filter(r => !r.success && !r.rejected).length;
    const rej = this.results.filter(r => r.rejected).length;
    let msg = '';
    if (ok) msg = `Done — ${ok} file(s) saved`;
    else if (fail) msg = `Write failed (${fail}) — check path / Accept to retry`;
    else if (rej) msg = `Skipped ${rej} file(s)`;
    setTurnStatus(this.app, msg || null);

    this._resolveAll?.({
      applied: this.results.filter(r => r.success).length,
      pending: this.totalEnqueued,
      results: this.results
    });
    this._resolveAll = null;
  }

  _pump() {
    if (this.busy) return;
    const next = this.queue.find(e => !e._done && !e._shown);
    if (!next) {
      this._maybeFinish();
      return;
    }
    this.busy = true;
    next._shown = true;
    this._showConfirm(next);
  }

  _entryPartData(entry) {
    return {
      path: entry.path,
      oldContent: entry.oldText || '',
      newContent: entry.content,
      lang: entry.lang,
      fcName: 'create_or_update_file'
    };
  }

  _showConfirm(entry) {
    setTurnStatus(this.app, `File ${this.settled + 1} of ${Math.max(this.totalEnqueued, this.settled + 1)} — Accept to save, Reject to skip`);

    if (this.autoApply) {
      (async () => {
        if (!entry._writeAttempted) entry._writeAttempted = true;
        paintFilePart(this.app, { ...this._entryPartData(entry), verb: 'Writing', status: PART_STATUS.STREAMING });

        let res;
        try {
          res = await writeEntry(entry);
        } catch (err) {
          res = { success: false, path: entry.path, error: err?.message || String(err) };
        }
        if (res.success) {
          this.results.push(res);
          entry._done = true;
          entry._applied = true;
          this.settled++;
          paintFilePart(this.app, { ...this._entryPartData(entry), verb: 'Saved', status: PART_STATUS.SAVED });
          this.onApplied?.(res);
          this.busy = false;
          this._pump();
          return;
        }

        console.warn(TAG, 'autoApply write failed — confirm UI', entry.path, res.error);
        this.results.push(res);
        const el = paintFilePart(this.app, { ...this._entryPartData(entry), verb: 'Save failed', status: PART_STATUS.ERROR });
        this.autoApply = false;
        entry._shown = true;
        entry._done = false;

        if (el) {
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
          actions.querySelector('.gpt-btn-accept').onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            this._doWrite(entry, true);
          };
          actions.querySelector('.gpt-btn-reject').onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            this._doWrite(entry, false);
          };
        }
        this.busy = true; // wait for user
      })();
      return;
    }

    const el = paintFilePart(this.app, { ...this._entryPartData(entry), verb: 'Reviewing', status: PART_STATUS.STREAMING });
    if (!el) {
      // No active turn — write silently rather than deadlocking the queue.
      this._doWrite(entry, true);
      return;
    }
    el.classList.add('is-confirming');
    try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}

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
    actions.querySelector('.gpt-btn-accept').onclick = (e) => { e.preventDefault(); e.stopPropagation(); this._doWrite(entry, true); };
    actions.querySelector('.gpt-btn-reject').onclick = (e) => { e.preventDefault(); e.stopPropagation(); this._doWrite(entry, false); };

    if (this.app.chatBox) this.app.chatBox.scrollTop = this.app.chatBox.scrollHeight;
  }

  async _doWrite(entry, accepted) {
    if (!accepted) {
      entry._done = true;
      entry._rejected = true;
      this.settled++;
      this.results.push({ success: false, path: entry.path, rejected: true });
      paintFilePart(this.app, { ...this._entryPartData(entry), verb: 'Rejected', status: PART_STATUS.REJECTED });
      this.busy = false;
      this._pump();
      return;
    }

    paintFilePart(this.app, { ...this._entryPartData(entry), verb: 'Writing', status: PART_STATUS.STREAMING });
    try {
      const res = await writeEntry(entry);
      if (!res.success) console.warn(TAG, 'write failed', entry.path, res.error);
      this.results.push(res);
      entry._done = true;
      entry._applied = !!res.success;
      this.settled++;
      paintFilePart(this.app, {
        ...this._entryPartData(entry),
        verb: res.success ? 'Saved' : 'Save failed',
        status: res.success ? PART_STATUS.SAVED : PART_STATUS.ERROR
      });
      this.onApplied?.(res);
      if (typeof window.toast === 'function') {
        window.toast(res.success ? `Saved ${(entry.path || '').split('/').pop()}` : (res.error || 'Failed'), 1600);
      }
    } catch (err) {
      entry._done = true;
      this.settled++;
      this.results.push({ success: false, path: entry.path, error: err?.message });
      paintFilePart(this.app, { ...this._entryPartData(entry), verb: 'Save failed', status: PART_STATUS.ERROR });
    }
    this.busy = false;
    this._pump();
  }
}

/** Kept for backward-compat callers — no-op now that fences never reach chat text directly. */
export function stripCodeFencesFromChunk(chunk) {
  return String(chunk || '');
}