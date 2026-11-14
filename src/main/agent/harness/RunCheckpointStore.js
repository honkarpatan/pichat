/**
 * Durable-lite checkpoints for agent runs.
 * Incomplete = status === 'running' only. Discard/finish DELETE the row (not soft-done).
 */

const DB_NAME = 'aicode_agent_runs';
const STORE = 'checkpoints';
const MEM = new Map();
const STALE_MS = 6 * 60 * 60 * 1000; // 6h auto-purge

function openDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NameSafe(), 1);
      req.onerror = () => resolve(null);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'runId' });
        }
      };
    } catch (_) {
      resolve(null);
    }
  });
}

function DB_NameSafe() {
  return DB_NAME;
}

async function idbDelete(runId) {
  const db = await openDb();
  if (!db || !runId) return;
  try {
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(runId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (_) {}
}

async function idbGetAll() {
  const db = await openDb();
  if (!db) return [];
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (_) {
    return [];
  }
}

export const RunCheckpointStore = {
  async save(cp) {
    if (!cp?.runId) return;
    const row = {
      runId: cp.runId,
      conversationId: String(cp.conversationId ?? ''),
      step: cp.step || 0,
      status: cp.status || 'running',
      loadedTools: Array.isArray(cp.loadedTools) ? cp.loadedTools : [],
      meta: cp.meta || {},
      updatedAt: Date.now()
    };
    // Never persist non-running as incomplete
    if (row.status !== 'running') {
      MEM.delete(row.runId);
      await idbDelete(row.runId);
      return;
    }
    MEM.set(row.runId, row);
    const db = await openDb();
    if (!db) return;
    try {
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) {}
  },

  async get(runId) {
    if (!runId) return null;
    if (MEM.has(runId)) return MEM.get(runId);
    const db = await openDb();
    if (!db) return null;
    try {
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(runId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  },

  /**
   * @param {number} limit
   * @param {{ conversationId?: string, onlyConversation?: boolean }} [opts]
   */
  async listIncomplete(limit = 10, opts = {}) {
    const onlyConv = opts.onlyConversation !== false && opts.conversationId != null;
    const wantConv = opts.conversationId != null ? String(opts.conversationId) : null;
    const now = Date.now();
    const out = [];
    const seen = new Set();

    const consider = async (row) => {
      if (!row?.runId || row.status !== 'running') return;
      if (seen.has(row.runId)) return;
      // Auto-purge stale
      if (row.updatedAt && now - row.updatedAt > STALE_MS) {
        await this.discard(row.runId);
        return;
      }
      if (onlyConv && wantConv != null && String(row.conversationId ?? '') !== wantConv) {
        return;
      }
      seen.add(row.runId);
      out.push(row);
    };

    for (const row of MEM.values()) {
      await consider(row);
    }
    const rows = await idbGetAll();
    for (const r of rows) {
      await consider(r);
    }

    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit);
  },

  /** Hard delete — banner must never see this run again */
  async discard(runId) {
    if (!runId) return;
    MEM.delete(runId);
    await idbDelete(runId);
  },

  async discardAll(filter = {}) {
    const wantConv = filter.conversationId != null ? String(filter.conversationId) : null;
    const all = await idbGetAll();
    const ids = new Set([...MEM.keys(), ...all.map(r => r.runId)]);
    for (const id of ids) {
      const row = MEM.get(id) || all.find(r => r.runId === id);
      if (!row) {
        await idbDelete(id);
        continue;
      }
      if (wantConv != null && String(row.conversationId ?? '') !== wantConv) continue;
      if (row.status === 'running' || filter.force) {
        await this.discard(id);
      }
    }
  },

  async markDone(runId, status = 'done') {
    // Always hard-remove so restart never shows banner
    await this.discard(runId);
  },

  /** Remove every running checkpoint (settings / nuclear discard) */
  async purgeAllRunning() {
    const all = await idbGetAll();
    for (const r of all) {
      if (r.status === 'running' || r.status === 'done' || r.status === 'aborted') {
        await this.discard(r.runId);
      }
    }
    for (const id of [...MEM.keys()]) {
      await this.discard(id);
    }
  }
};
