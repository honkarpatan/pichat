
/**
 * UndoStore — previous file bodies after agent writes.
 * Canvas header Undo restores last snapshot for the open path.
 */

const TAG = '[UndoStore]';

function keyOf(path) {
  let s = String(path || '');
  const i = s.lastIndexOf('::');
  if (i !== -1) s = s.slice(i + 2);
  s = s.replace(/^primary:/i, '').replace(/^\/+/, '');
  return s.toLowerCase() || s;
}

export class UndoStore {
  static map(app) {
    if (!app._fileUndoMap) app._fileUndoMap = new Map();
    return app._fileUndoMap;
  }

  /**
   * Save pre-write snapshot (only first in a chain keeps oldest until undo).
   * @param {object} app
   * @param {{ path: string, oldContent: string, newContent?: string, url?: string }} row
   */
  static push(app, row) {
    if (!row?.path || row.oldContent == null) return;
    const map = UndoStore.map(app);
    const k = keyOf(row.path);
    // Keep the oldest pre-write content for this path in the turn if already staged
    if (!map.has(k)) {
      map.set(k, {
        path: row.path,
        url: row.url || null,
        oldContent: String(row.oldContent),
        newContent: row.newContent != null ? String(row.newContent) : null,
        at: Date.now()
      });
      console.log(TAG, 'snapshot', k, 'bytes=', String(row.oldContent).length);
    }
  }

  static get(app, path) {
    return UndoStore.map(app).get(keyOf(path)) || null;
  }

  static has(app, path) {
    return UndoStore.map(app).has(keyOf(path));
  }

  static async undo(app, path) {
    const snap = UndoStore.get(app, path);
    if (!snap) return { success: false, error: 'Nothing to undo' };
    try {
      const { applyFileBlocks } = await import('../file/FileBlockApplier.js');
      let fencePath = keyOf(path);
      try {
        const { getProjectFolder } = await import('../file/fileOperations.js');
        const proj = await getProjectFolder();
        const pname = (proj?.name || '').replace(/\/$/, '');
        if (pname && fencePath.startsWith(pname.toLowerCase() + '/')) {
          fencePath = fencePath.slice(pname.length + 1);
        }
        if (pname && fencePath.includes('/' + pname.toLowerCase() + '/')) {
          fencePath = fencePath.split('/' + pname.toLowerCase() + '/').pop();
        }
      } catch (_) {}
      const lang = (fencePath.split('.').pop() || '').slice(0, 12);
      const md = '```' + lang + ' file="' + fencePath.replace(/"/g, '') + '"\n' + snap.oldContent + '\n```';
      const result = await applyFileBlocks(md);
      const row = result.applied?.[0];
      const ok = !!(row && row.success);
      if (ok) {
        UndoStore.map(app).delete(keyOf(path));
        if (typeof window.toast === 'function') window.toast('Undone: ' + (fencePath.split('/').pop() || fencePath), 2000);
      }
      return { success: ok, error: row?.error, url: row?.url || snap.url };
    } catch (e) {
      console.error(TAG, 'undo failed', e);
      return { success: false, error: e?.message || String(e) };
    }
  }
}
