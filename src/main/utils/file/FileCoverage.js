import { computeLineDiff } from './DiffUtil.js';

/**
 * File read/edit coverage for agent UI progress bar.
 * Multiple section reads of the same file merge into one bar; edits reset reads and mark change lines.
 */

export function fileBaseName(path) {
  return String(path || '').split(/[/\\]/).filter(Boolean).pop() || '';
}

export function normalizeRange(start, end, totalHint) {
  let s = Number(start);
  let e = Number(end);
  if (!Number.isFinite(s) || s < 1) s = 1;
  if (!Number.isFinite(e) || e < s) e = s;
  if (totalHint && e > totalHint) {
    // allow growth
  }
  return { start: Math.floor(s), end: Math.floor(e) };
}

/** Merge overlapping/adjacent inclusive ranges */
export function mergeRanges(ranges) {
  const list = (ranges || [])
    .map(r => normalizeRange(r.start, r.end, r.total))
    .filter(r => r.end >= r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!list.length) return [];
  const out = [list[0]];
  for (let i = 1; i < list.length; i++) {
    const cur = list[i];
    const last = out[out.length - 1];
    if (cur.start <= last.end + 1) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function coveredLineCount(ranges) {
  return mergeRanges(ranges).reduce((n, r) => n + (r.end - r.start + 1), 0);
}

/**
 * @returns {string} HTML for thin coverage bar (0–100% width track)
 * totalLines: estimated file length (max of known ends / content lines)
 * readRanges: [{start,end}]
 * editRanges: [{start,end}] optional change marks
 */
export function coverageBarHtml({
  totalLines = 0,
  readRanges = [],
  editRanges = [],
  addRanges = [],
  removeRanges = [],
  mode = 'read'
} = {}) {
  const total = Math.max(1, Number(totalLines) || 1);
  const reads = mergeRanges(readRanges);
  const adds = mergeRanges(addRanges);
  const removes = mergeRanges(removeRanges);
  const edits = (!adds.length && !removes.length) ? mergeRanges(editRanges) : [];
  const isEdit = !!(adds.length || removes.length || edits.length);

  const pct = (start, end) => {
    const left = ((Math.max(1, start) - 1) / total) * 100;
    const width = ((Math.max(start, end) - Math.max(1, start) + 1) / total) * 100;
    return {
      left: Math.max(0, Math.min(100, left)),
      width: Math.max(0.5, Math.min(100 - left, width))
    };
  };

  // READ: single horizontal track (blue marks only where read)
  if (!isEdit) {
    if (!reads.length) return '';
    const segs = reads.map(r => {
      const { left, width } = pct(r.start, r.end);
      return `<span class="gpt-oc-cov-seg is-read" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>`;
    }).join('');
    const readPct = Math.min(100, Math.round((coveredLineCount(reads) / total) * 100));
    return `<span class="gpt-oc-cov" data-mode="read" title="read ${readPct}% of ~${total} lines" aria-hidden="true"><span class="gpt-oc-cov-track">${segs}</span></span>`;
  }

  // EDIT: dual thin tracks — top = add (green), bottom = remove (red); grey base
  // SVG for sub-pixel accurate marks (lightweight, no canvas)
  const svgRects = (ranges, y, h, cls) => ranges.map(r => {
    const { left, width } = pct(r.start, r.end);
    return `<rect class="${cls}" x="${left.toFixed(3)}" y="${y}" width="${width.toFixed(3)}" height="${h}" rx="0.4" />`;
  }).join('');

  // Generic edits (no add/remove split) → show on both tracks lightly as is-edit
  const topMarks = adds.length ? svgRects(adds, 0.15, 3.1, 'is-add') : svgRects(edits, 0.15, 3.1, 'is-edit');
  const botMarks = removes.length ? svgRects(removes, 4.75, 3.1, 'is-remove') : svgRects(edits, 4.75, 3.1, 'is-edit');

  const hunks = Math.max(adds.length, removes.length, edits.length);
  const title = [
    `~${total} lines`,
    removes.length ? `−${coveredLineCount(removes)}` : '',
    adds.length ? `+${coveredLineCount(adds)}` : '',
    edits.length ? `edit ${coveredLineCount(edits)}` : '',
    hunks > 1 ? `${hunks} hunks` : ''
  ].filter(Boolean).join(' · ');

  return `<span class="gpt-oc-cov gpt-oc-cov-dual" data-mode="edit" title="${title.replace(/"/g, '&quot;')}" aria-hidden="true">
    <svg class="gpt-oc-cov-svg" viewBox="0 0 100 8" preserveAspectRatio="none" width="72" height="8">
      <rect class="gpt-oc-cov-base" x="0" y="0.15" width="100" height="3.1" rx="0.6" />
      <rect class="gpt-oc-cov-base" x="0" y="4.75" width="100" height="3.1" rx="0.6" />
      ${topMarks}
      ${botMarks}
    </svg>
  </span>`;
}

/**
 * Line-accurate add/remove ranges from full old vs new file text (for str_replace / write).
 */
export function rangesFromFullFileDiff(oldText, newText) {
  const oldLines = String(oldText ?? '').split(/\n/);
  const newLines = String(newText ?? '').split(/\n/);
  const ops = computeLineDiff(oldText ?? '', newText ?? '');
  const removeRanges = [];
  const addRanges = [];
  let rs = null, re = null, as_ = null, ae = null;
  const flushDel = () => {
    if (rs != null) {
      removeRanges.push({ start: rs, end: re });
      rs = re = null;
    }
  };
  const flushAdd = () => {
    if (as_ != null) {
      addRanges.push({ start: as_, end: ae });
      as_ = ae = null;
    }
  };
  for (const o of ops) {
    if (o.type === 'del' && o.oldLn != null) {
      flushAdd();
      if (rs == null) rs = o.oldLn;
      re = o.oldLn;
    } else if (o.type === 'add' && o.newLn != null) {
      flushDel();
      if (as_ == null) as_ = o.newLn;
      ae = o.newLn;
    } else {
      flushDel();
      flushAdd();
    }
  }
  flushDel();
  flushAdd();
  return {
    removeRanges: mergeRanges(removeRanges),
    addRanges: mergeRanges(addRanges),
    editRanges: mergeRanges([...removeRanges, ...addRanges]),
    fileTotalLines: Math.max(oldLines.length, newLines.length, 1)
  };
}

/**
 * Build add/remove ranges for a contiguous line edit (edit_file_lines style).
 */
export function rangesFromLineEdit({ start, end, newContent } = {}) {
  const s = Math.max(1, Math.floor(Number(start) || 1));
  const e = Math.max(s, Math.floor(Number(end) || s));
  const newLines = Math.max(0, String(newContent ?? '').split(/\r?\n/).length);
  const removeRanges = [{ start: s, end: e }];
  const addRanges = newLines > 0
    ? [{ start: s, end: s + newLines - 1 }]
    : [];
  return { removeRanges, addRanges, editRanges: [{ start: s, end: Math.max(e, s + Math.max(0, newLines - 1)) }] };
}

/**
 * Heuristic: outline / tool dump must not be shown as file oldContent in diffs.
 */
export function looksLikeNonFileContent(text) {
  const t = String(text || '');
  if (!t) return false;
  if (/\[OUTLINE\b/i.test(t)) return true;
  if (/^L\d+\s*[–-]\s*\d+\s+\w+/m.test(t) && /\[Ranges are Lstart/i.test(t)) return true;
  if (/\bfunction\/class ranges\b/i.test(t)) return true;
  return false;
}


/** Guess total lines from content string or max range end */
export function estimateTotalLines({ content, ranges, previousTotal }) {
  let fromContent = 0;
  if (content != null && String(content).length) {
    fromContent = String(content).split(/\r?\n/).length;
  }
  const maxEnd = (ranges || []).reduce((m, r) => Math.max(m, Number(r.end) || 0), 0);
  return Math.max(Number(previousTotal) || 0, fromContent, maxEnd, 1);
}

/** Extract start/end from tool args */
export function rangeFromArgs(args = {}, content = null) {
  const a = args || {};
  let start = a.start_line ?? a.startLine ?? a.offset;
  let end = a.end_line ?? a.endLine;
  if (start != null && end == null && a.limit != null) {
    end = Number(start) + Number(a.limit) - 1;
  }
  if ((start == null || end == null) && content != null) {
    const n = String(content).split(/\r?\n/).length;
    start = start ?? 1;
    end = end ?? n;
  }
  if (start == null && end == null) {
    // Full-file read without range — treat as unknown until we have content
    if (content != null) {
      const n = Math.max(1, String(content).split(/\r?\n/).length);
      return { start: 1, end: n };
    }
    return null;
  }
  return normalizeRange(start ?? 1, end ?? start ?? 1);
}
