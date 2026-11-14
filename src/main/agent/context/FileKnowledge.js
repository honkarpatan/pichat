/**
 * M4 — Per-run file evidence store.
 * Survives compaction: ranges read, anchors, edits — re-injected as [Working Notes].
 */

const TAG = '[FileKnowledge]';

function baseName(p) {
  return String(p || '').split(/[/\\]/).filter(Boolean).pop() || String(p || '');
}

function normPath(p) {
  return String(p || '').trim().replace(/\\/g, '/');
}

function parseRange(range, start, end) {
  if (range && typeof range === 'string' && range.includes('-')) {
    const [a, b] = range.split('-').map(x => parseInt(x, 10));
    if (Number.isFinite(a)) return { start: a, end: Number.isFinite(b) ? b : a };
  }
  const s = parseInt(start, 10);
  const e = parseInt(end, 10);
  if (Number.isFinite(s)) return { start: s, end: Number.isFinite(e) ? e : s };
  return null;
}

function mergeRanges(ranges) {
  if (!ranges?.length) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const r of sorted) {
    if (!out.length || r.start > out[out.length - 1].end + 1) {
      out.push({ start: r.start, end: r.end });
    } else {
      out[out.length - 1].end = Math.max(out[out.length - 1].end, r.end);
    }
  }
  return out;
}

export function createFileKnowledge() {
  return {
    files: new Map(), // key → { path, pathRelative, totalLines, ranges[], anchors[], edits[], outline[] }
    notes: []
  };
}

export function getFileKnowledge(app) {
  if (!app) return null;
  if (!app._fileKnowledge) app._fileKnowledge = createFileKnowledge();
  return app._fileKnowledge;
}

export function clearFileKnowledge(app) {
  if (app) app._fileKnowledge = createFileKnowledge();
}

function entryFor(store, path, pathRelative) {
  const key = normPath(pathRelative || path || '').toLowerCase() || baseName(path);
  if (!store.files.has(key)) {
    store.files.set(key, {
      path: path || '',
      pathRelative: pathRelative || baseName(path),
      totalLines: null,
      ranges: [],
      anchors: [],
      edits: [],
      outline: []
    });
  }
  const e = store.files.get(key);
  if (path) e.path = path;
  if (pathRelative) e.pathRelative = pathRelative;
  return e;
}

/** Record a successful read / outline / edit from tool response. */
export function noteToolEvidence(app, toolName, response = {}, args = {}) {
  try {
    const store = getFileKnowledge(app);
    if (!store || !response || response.error || response.success === false) return;

    const name = String(toolName || '');
    const path = response.path || args.path || '';
    const pathRelative = response.pathRelative || baseName(path);

    if (name === 'read' || name === 'read_file') {
      const e = entryFor(store, path, pathRelative);
      if (response.totalLines != null) e.totalLines = response.totalLines;
      const rg = parseRange(response.range, args.start_line, args.end_line);
      if (rg) e.ranges = mergeRanges([...e.ranges, rg]);
      const body = response.content || response.numbered || '';
      const anchors = extractAnchors(typeof body === 'string' ? body : '');
      for (const a of anchors) {
        if (!e.anchors.includes(a)) e.anchors.push(a);
      }
      e.anchors = e.anchors.slice(0, 24);
      return;
    }

    if (name === 'outline') {
      const e = entryFor(store, path, pathRelative);
      if (response.totalLines != null) e.totalLines = response.totalLines;
      const syms = response.symbols || [];
      for (const s of syms.slice(0, 40)) {
        const label = `${s.kind || ''} ${s.name || ''}@${s.line || '?'}`.trim();
        if (label && !e.outline.includes(label)) e.outline.push(label);
      }
      e.outline = e.outline.slice(0, 40);
      return;
    }

    if (/^(str_replace|edit_file_lines|write|search_replace_edit|apply_patch|multi_edit)$/.test(name)) {
      const e = entryFor(store, path, pathRelative);
      e.edits.push({
        tool: name,
        at: Date.now(),
        note: response.message || response.summary || 'ok'
      });
      e.edits = e.edits.slice(-8);
      // Edit invalidates pure "must re-read" — keep ranges but mark dirty
      e.dirty = true;
      return;
    }

    if (name === 'grep') {
      const matches = response.matches || [];
      const sample = (Array.isArray(matches) ? matches : []).slice(0, 5).map(m => {
        if (typeof m === 'string') return m.slice(0, 80);
        return `${m.file || ''}:${m.line || ''}: ${String(m.text || '').slice(0, 40)}`;
      });
      if (sample.length) {
        store.notes.push(`grep "${response.pattern || args.pattern || ''}" → ${sample.join(' | ')}`);
        store.notes = store.notes.slice(-12);
      }
    }
  } catch (e) {
    console.warn(TAG, 'noteToolEvidence', e?.message || e);
  }
}

function extractAnchors(text, max = 8) {
  const s = String(text || '');
  if (!s) return [];
  const found = [];
  const patterns = [
    /id=["']([^"']+)["']/gi,
    /class=["']([^"']+)["']/gi,
    /\.([a-zA-Z_][\w-]*)\s*\{/g,
    /function\s+([a-zA-Z_]\w*)/g,
    /<style\b/gi,
    /<script\b/gi
  ];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(s)) && found.length < max) {
      const hit = (m[1] || m[0] || '').toString().slice(0, 40);
      if (hit && !found.includes(hit)) found.push(hit);
    }
  }
  return found;
}

/**
 * Compact [Working Notes] block for injection after compaction.
 */
export function formatWorkingNotes(app, maxChars = 1800) {
  const store = getFileKnowledge(app);
  if (!store || (!store.files.size && !store.notes.length)) return '';

  const lines = ['[Working Notes — do NOT re-read these ranges unless editing a different section]'];
  for (const e of store.files.values()) {
    const label = e.pathRelative || baseName(e.path) || 'file';
    const total = e.totalLines != null ? ` ~${e.totalLines} lines` : '';
    const dirty = e.dirty ? ' (edited this run)' : '';
    lines.push(`• ${label}${total}${dirty}`);
    if (e.ranges.length) {
      lines.push(`  read: ${e.ranges.map(r => `${r.start}-${r.end}`).join(', ')}`);
    }
    if (e.outline.length) {
      lines.push(`  outline: ${e.outline.slice(0, 8).join('; ')}`);
    }
    if (e.anchors.length) {
      lines.push(`  anchors: ${e.anchors.slice(0, 10).join('; ')}`);
    }
    if (e.edits.length) {
      lines.push(`  edits: ${e.edits.map(x => x.tool).join(', ')}`);
    }
  }
  for (const n of store.notes.slice(-6)) {
    lines.push(`• ${n}`);
  }

  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…';
  return text;
}

export const FileKnowledge = {
  createFileKnowledge,
  getFileKnowledge,
  clearFileKnowledge,
  noteToolEvidence,
  formatWorkingNotes
};
