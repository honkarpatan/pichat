/**
 * Per-chat response-level undo / redo for agent file operations.
 *
 * One /undo reverts the last assistant response's entire FS batch
 * (create, edit, delete, rename/move/copy, project memory, …).
 * Stacks are isolated by conversation index — another chat cannot undo this one.
 */

import { createFile, readFile } from '../file/fileOperations.js';
import { getProjectFolder, joinSafPath, normalizeSafUrl } from '../file/fileOperations.js';
import { ConfigManager } from '../ConfigManager.js';

const TAG = '[FileChangeHistory]';

const DEFAULT_MAX_BATCHES = 20;
const HARD_MAX_BATCHES = 50;
const DEFAULT_MAX_STORAGE_MB = 25;

function stackKey(app) {
  return String(app?.currentConversationIndex ?? '0');
}

function limits() {
  let maxBatches = Number(ConfigManager.get('undoMaxBatches'));
  if (!Number.isFinite(maxBatches) || maxBatches < 1) maxBatches = DEFAULT_MAX_BATCHES;
  maxBatches = Math.min(HARD_MAX_BATCHES, Math.max(1, Math.floor(maxBatches)));

  let maxMb = Number(ConfigManager.get('undoMaxStorageMb'));
  if (!Number.isFinite(maxMb) || maxMb < 1) maxMb = DEFAULT_MAX_STORAGE_MB;
  maxMb = Math.min(200, Math.max(1, Math.floor(maxMb)));

  return { maxBatches, maxBytes: maxMb * 1024 * 1024 };
}

function ensure(app) {
  if (!app._fileHistory) app._fileHistory = {};
  const k = stackKey(app);
  if (!app._fileHistory[k]) app._fileHistory[k] = { undo: [], redo: [], openBatch: null };
  return app._fileHistory[k];
}

function convOf(app) {
  try {
    const idx = parseInt(app?.currentConversationIndex, 10);
    if (!Number.isFinite(idx) || idx < 0) return null;
    return app.conversations?.[idx] || null;
  } catch (_) {
    return null;
  }
}

function estimateBytes(batch) {
  let n = 64;
  for (const op of batch?.ops || []) {
    n += String(op.before || '').length + String(op.after || '').length + String(op.path || '').length + 48;
  }
  return n;
}

function trimStacks(st) {
  const { maxBatches, maxBytes } = limits();
  while (st.undo.length > maxBatches) st.undo.shift();
  let total = st.undo.reduce((s, b) => s + estimateBytes(b), 0)
    + st.redo.reduce((s, b) => s + estimateBytes(b), 0);
  while (st.undo.length > 1 && total > maxBytes) {
    const dropped = st.undo.shift();
    total -= estimateBytes(dropped);
  }
}

function persist(app, st) {
  const conv = convOf(app);
  if (!conv) return;
  conv.fileHistory = {
    undo: st.undo.map(b => ({ ...b, ops: b.ops })),
    redo: st.redo.map(b => ({ ...b, ops: b.ops }))
  };
  try {
    if (app.storageManager?.saveConversations) {
      app.storageManager.saveConversations(app.conversations).catch?.(() => {});
    }
  } catch (_) {}
}

function chatTitle(app, idx) {
  try {
    const c = app.conversations?.[idx];
    if (!c) return `Chat ${idx}`;
    return String(c.title || c.name || c.chat?.[0]?.content || `Chat ${idx}`).slice(0, 48);
  } catch (_) {
    return `Chat ${idx}`;
  }
}

async function resolveWrite(path, content) {
  const project = await getProjectFolder();
  if (!project?.uri) throw new Error('No project folder');
  let parent;
  let name;
  if (String(path).startsWith('content://')) {
    const url = normalizeSafUrl(path);
    name = url.split('/').pop();
    parent = url.substring(0, url.lastIndexOf('/'));
  } else {
    parent = normalizeSafUrl(project.uri);
    name = String(path).split('/').pop();
    const rel = String(path).replace(/^\.\//, '');
    if (rel.includes('/')) {
      const parts = rel.split('/');
      name = parts.pop();
      parent = joinSafPath(parent, parts.join('/'));
    }
  }
  return createFile(parent, name, content, { overwrite: true });
}

async function resolveDelete(path) {
  try {
    const fs = typeof acode !== 'undefined' ? acode.require('fsOperation') || acode.require('fs') : null;
    if (!fs) return;
    const url = String(path).startsWith('content://') ? normalizeSafUrl(path) : path;
    const handle = fs(url);
    if (await handle.exists()) await handle.delete();
  } catch (e) {
    console.warn(TAG, 'delete', e?.message || e);
  }
}

export const FileChangeHistory = {
  DEFAULT_MAX_BATCHES,
  HARD_MAX_BATCHES,
  DEFAULT_MAX_STORAGE_MB,

  hydrate(app) {
    try {
      const conv = convOf(app);
      if (conv?.fileHistory) {
        if (!app._fileHistory) app._fileHistory = {};
        app._fileHistory[stackKey(app)] = {
          undo: Array.isArray(conv.fileHistory.undo) ? conv.fileHistory.undo : [],
          redo: Array.isArray(conv.fileHistory.redo) ? conv.fileHistory.redo : [],
          openBatch: null
        };
      }
    } catch (_) {}
  },

  /** Start grouping ops for the current agent/assistant response. */
  beginBatch(app, meta = {}) {
    this.hydrate(app);
    const st = ensure(app);
    if (st.openBatch?.ops?.length) {
      this.endBatch(app);
    }
    st.openBatch = {
      id: meta.id || `batch-${Date.now()}`,
      at: Date.now(),
      chatIndex: parseInt(app?.currentConversationIndex, 10) || 0,
      label: meta.label || '',
      ops: []
    };
  },

  endBatch(app) {
    const st = ensure(app);
    const batch = st.openBatch;
    st.openBatch = null;
    if (!batch || !batch.ops.length) return null;
    st.undo.push(batch);
    st.redo = [];
    trimStacks(st);
    persist(app, st);
    console.log(TAG, 'batch closed', batch.ops.length, 'ops');
    return batch;
  },

  /**
   * Record one FS op. Prefer calling inside an open batch (one response).
   * If no batch is open, opens a single-op batch immediately (legacy callers).
   */
  push(app, {
    path,
    before = '',
    after = '',
    label = '',
    op = 'edit',
    fromPath = null,
    toPath = null
  } = {}) {
    if (!app || (!path && !fromPath && !toPath)) return;
    this.hydrate(app);
    const st = ensure(app);
    if (!st.openBatch) {
      this.beginBatch(app, { label: label || 'edit' });
    }
    st.openBatch.ops.push({
      path: String(path || toPath || fromPath || ''),
      before: before == null ? '' : String(before),
      after: after == null ? '' : String(after),
      label: label || String(path || '').split('/').pop() || op,
      op: op || 'edit',
      fromPath: fromPath || null,
      toPath: toPath || null,
      ts: Date.now()
    });
  },

  canUndo(app) {
    this.hydrate(app);
    return ensure(app).undo.length > 0;
  },

  canRedo(app) {
    this.hydrate(app);
    return ensure(app).redo.length > 0;
  },

  undoLen(app) {
    this.hydrate(app);
    return ensure(app).undo.length;
  },

  async _applyOpReverse(op) {
    const kind = op.op || 'edit';
    if (kind === 'delete') {
      // Undo delete → restore file
      if (op.before != null) await resolveWrite(op.path, op.before);
      return;
    }
    if (kind === 'create' || kind === 'write') {
      // Undo create → remove file if before was empty
      if (!op.before) await resolveDelete(op.path);
      else await resolveWrite(op.path, op.before);
      return;
    }
    if (kind === 'rename' || kind === 'move') {
      // Undo: write content back to fromPath, delete toPath if needed
      const from = op.fromPath || op.path;
      const to = op.toPath;
      if (from && op.before != null) await resolveWrite(from, op.before);
      if (to && to !== from) await resolveDelete(to);
      return;
    }
    if (kind === 'copy') {
      // Undo copy → delete destination
      if (op.toPath) await resolveDelete(op.toPath);
      return;
    }
    // edit / memory / default: restore before
    await resolveWrite(op.path, op.before);
  },

  async _applyOpForward(op) {
    const kind = op.op || 'edit';
    if (kind === 'delete') {
      await resolveDelete(op.path);
      return;
    }
    if (kind === 'rename' || kind === 'move') {
      const to = op.toPath || op.path;
      if (to && op.after != null) await resolveWrite(to, op.after);
      if (op.fromPath && op.fromPath !== to) await resolveDelete(op.fromPath);
      return;
    }
    if (kind === 'copy') {
      if (op.toPath && op.after != null) await resolveWrite(op.toPath, op.after);
      return;
    }
    await resolveWrite(op.path, op.after);
  },

  /** Undo last response batch (all ops in reverse). */
  async undo(app) {
    this.hydrate(app);
    const st = ensure(app);
    if (st.openBatch?.ops?.length) this.endBatch(app);
    const batch = st.undo.pop();
    if (!batch) return { ok: false, message: 'Nothing to undo in this chat' };

    const restored = [];
    try {
      for (let i = batch.ops.length - 1; i >= 0; i--) {
        const op = batch.ops[i];
        await this._applyOpReverse(op);
        restored.push(op.label || op.path);
      }
      st.redo.push(batch);
      trimStacks(st);
      persist(app, st);
      const msg = batch.ops.length === 1
        ? `Undid change to ${restored[0]}`
        : `Undid ${batch.ops.length} changes from last response`;
      return { ok: true, message: msg, batch, count: batch.ops.length };
    } catch (e) {
      st.undo.push(batch);
      return { ok: false, message: e.message || String(e) };
    }
  },

  async redo(app) {
    this.hydrate(app);
    const st = ensure(app);
    const batch = st.redo.pop();
    if (!batch) return { ok: false, message: 'Nothing to redo in this chat' };

    try {
      for (const op of batch.ops) {
        await this._applyOpForward(op);
      }
      st.undo.push(batch);
      trimStacks(st);
      persist(app, st);
      const msg = batch.ops.length === 1
        ? `Redid change to ${batch.ops[0].label || batch.ops[0].path}`
        : `Redid ${batch.ops.length} changes`;
      return { ok: true, message: msg, batch, count: batch.ops.length };
    } catch (e) {
      st.redo.push(batch);
      return { ok: false, message: e.message || String(e) };
    }
  },

  /** Summaries for Storage & Privacy list */
  listAllChats(app) {
    const out = [];
    const convs = app?.conversations || [];
    for (let i = 0; i < convs.length; i++) {
      const c = convs[i];
      const hist = c?.fileHistory;
      if (!hist) continue;
      const undo = Array.isArray(hist.undo) ? hist.undo : [];
      const redo = Array.isArray(hist.redo) ? hist.redo : [];
      if (!undo.length && !redo.length) continue;
      const bytes = undo.reduce((s, b) => s + estimateBytes(b), 0)
        + redo.reduce((s, b) => s + estimateBytes(b), 0);
      const lastAt = Math.max(
        0,
        ...undo.map(b => b.at || 0),
        ...redo.map(b => b.at || 0)
      );
      const ops = [];
      for (const b of undo) {
        for (const op of b.ops || []) {
          ops.push(op.label || op.path || op.op);
        }
      }
      out.push({
        chatIndex: i,
        title: chatTitle(app, i),
        undoBatches: undo.length,
        redoBatches: redo.length,
        opCount: ops.length,
        sampleOps: ops.slice(0, 8),
        bytes,
        lastAt
      });
    }
    return out.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  },

  clearChat(app, chatIndex) {
    const idx = parseInt(chatIndex, 10);
    if (!Number.isFinite(idx)) return false;
    try {
      const c = app.conversations?.[idx];
      if (c) c.fileHistory = { undo: [], redo: [] };
      if (app._fileHistory) delete app._fileHistory[String(idx)];
      if (app.storageManager?.saveConversations) {
        app.storageManager.saveConversations(app.conversations).catch?.(() => {});
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  clearAll(app) {
    try {
      for (const c of app.conversations || []) {
        if (c) c.fileHistory = { undo: [], redo: [] };
      }
      app._fileHistory = {};
      if (app.storageManager?.saveConversations) {
        app.storageManager.saveConversations(app.conversations).catch?.(() => {});
      }
      return true;
    } catch (_) {
      return false;
    }
  },

  totalStorageBytes(app) {
    return this.listAllChats(app).reduce((s, row) => s + (row.bytes || 0), 0);
  }
};
