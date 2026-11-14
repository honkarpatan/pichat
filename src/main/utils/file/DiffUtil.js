//
// Line-level diff → HTML matching LiveChatUI "good style":
//   <div class="gpt-diff-row gpt-diff-del">
//     <span class="gpt-diff-ln">-</span>
//     <span class="gpt-diff-sign">-</span>
//     <span class="gpt-diff-text">…</span>
//   </div>
//   <div class="gpt-diff-row gpt-diff-sep"><span class="gpt-diff-text">···</span></div>
//
// Used by FileCards (live + history) so restart looks identical to live.

// OPTIMIZED: Reduced from 250000 to 10000. 
// This forces large files (>100 lines) to use the fast fallback algorithm,
// preventing the Acode mobile main thread from freezing when massive chunks drop.
const MAX_CELLS = 10000;

export function escapeForDiff(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * Returns ops: { type: 'ctx'|'add'|'del', text, oldLn?, newLn? }
 */
export function computeLineDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  if (!oldText) {
    return newLines.map((text, j) => ({ type: 'add', text, newLn: j + 1 }));
  }
  if (!newText) {
    return oldLines.map((text, i) => ({ type: 'del', text, oldLn: i + 1 }));
  }

  if (m * n > MAX_CELLS) {
    // Fast path for large files: walk both sequences, emit ctx on equal lines,
    // otherwise consume a small mismatched window (avoids one giant del+add block).
    const ops = [];
    let i = 0;
    let j = 0;
    const WINDOW = 40;
    while (i < m || j < n) {
      if (i < m && j < n && oldLines[i] === newLines[j]) {
        ops.push({ type: 'ctx', text: oldLines[i], oldLn: i + 1, newLn: j + 1 });
        i++; j++;
        continue;
      }
      // Look ahead for a resync point within WINDOW
      let resync = null;
      const limI = Math.min(m, i + WINDOW);
      const limJ = Math.min(n, j + WINDOW);
      outer:
      for (let di = 0; di < limI - i; di++) {
        for (let dj = 0; dj < limJ - j; dj++) {
          if (di === 0 && dj === 0) continue;
          if (oldLines[i + di] === newLines[j + dj]) {
            // Prefer closer match
            if (!resync || di + dj < resync.di + resync.dj) {
              resync = { di, dj };
            }
            if (di + dj <= 2) break outer;
          }
        }
      }
      if (resync) {
        for (let k = 0; k < resync.di; k++) {
          ops.push({ type: 'del', text: oldLines[i + k], oldLn: i + k + 1 });
        }
        for (let k = 0; k < resync.dj; k++) {
          ops.push({ type: 'add', text: newLines[j + k], newLn: j + k + 1 });
        }
        i += resync.di;
        j += resync.dj;
      } else {
        // No nearby resync — emit remaining as del then add
        while (i < m) {
          ops.push({ type: 'del', text: oldLines[i], oldLn: i + 1 });
          i++;
        }
        while (j < n) {
          ops.push({ type: 'add', text: newLines[j], newLn: j + 1 });
          j++;
        }
      }
    }
    return ops;
  }

  const dp = new Array(m + 1);
  for (let i = 0; i <= m; i++) dp[i] = new Uint32Array(n + 1);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'ctx', text: oldLines[i], oldLn: i + 1, newLn: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: oldLines[i], oldLn: i + 1 });
      i++;
    } else {
      ops.push({ type: 'add', text: newLines[j], newLn: j + 1 });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: 'del', text: oldLines[i], oldLn: i + 1 });
    i++;
  }
  while (j < n) {
    ops.push({ type: 'add', text: newLines[j], newLn: j + 1 });
    j++;
  }
  return ops;
}

export function statsFromOps(ops) {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.type === 'add') added++;
    else if (o.type === 'del') removed++;
  }
  return { added, removed };
}

/**
 * Show only changed regions + nearby context.
 * - Drop pure leading/trailing unchanged blocks (keep at most ctxLines)
 * - Between distant change clusters insert ··· separator
 * - Between close clusters keep the short context run as-is
 */
export function collapseContext(ops, ctxLines = 2) {
  if (!ops || !ops.length) return [];
  const n = ops.length;
  const isChange = (o) => o && (o.type === 'add' || o.type === 'del');

  // Mark indices that are change or within ctxLines of a change
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!isChange(ops[i])) continue;
    const lo = Math.max(0, i - ctxLines);
    const hi = Math.min(n - 1, i + ctxLines);
    for (let k = lo; k <= hi; k++) keep[k] = 1;
  }

  // If file is brand-new (all add) or pure delete, keep everything (caller may maxRows)
  if (!keep.some(Boolean)) {
    return ops.slice();
  }

  const out = [];
  let i = 0;
  while (i < n) {
    if (keep[i]) {
      out.push(ops[i]);
      i++;
      continue;
    }
    // Skipped region — emit one separator if it sits between kept regions
    let j = i;
    while (j < n && !keep[j]) j++;
    const hadBefore = out.length > 0;
    const hasAfter = j < n;
    if (hadBefore && hasAfter) {
      // Line span omitted (for UI: "··· lines 41–129 ···")
      const before = out[out.length - 1];
      const after = ops[j];
      const fromLn = before?.newLn ?? before?.oldLn ?? null;
      const toLn = after?.newLn ?? after?.oldLn ?? null;
      out.push({
        type: 'sep',
        count: j - i,
        fromLn: fromLn != null ? fromLn + 1 : null,
        toLn: toLn != null ? toLn - 1 : null
      });
    }
    // Leading/trailing pure ctx: omit entirely (only diffs + nearby)
    i = j;
  }
  return out;
}

/**
 * Good-style row HTML (same as LiveChatUI live patches):
 *   ln + sign + text ; separators as gpt-diff-sep
 */
function opsToHtml(ops) {
  return ops.map((o) => {
    if (o.type === 'sep' || o.type === 'gap') {
      let label = '···';
      if (o.fromLn != null && o.toLn != null && o.toLn >= o.fromLn) {
        label = `··· lines ${o.fromLn}–${o.toLn} ···`;
      } else if (o.count > 0) {
        label = `··· ${o.count} unchanged line${o.count === 1 ? '' : 's'} ···`;
      }
      return `<div class="gpt-diff-row gpt-diff-sep"><span class="gpt-diff-text">${label}</span></div>`;
    }
    const cls = o.type === 'add' ? 'gpt-diff-add' : o.type === 'del' ? 'gpt-diff-del' : 'gpt-diff-ctx';
    const sign = o.type === 'add' ? '+' : o.type === 'del' ? '-' : '';
    // Line number: prefer old for del, new for add, either for ctx
    let ln = '';
    if (o.type === 'del') ln = o.oldLn != null ? String(o.oldLn) : '-';
    else if (o.type === 'add') ln = o.newLn != null ? String(o.newLn) : '+';
    else ln = o.newLn != null ? String(o.newLn) : (o.oldLn != null ? String(o.oldLn) : '');

    return `<div class="gpt-diff-row ${cls}"><span class="gpt-diff-ln">${ln}</span><span class="gpt-diff-sign">${sign}</span><span class="gpt-diff-text">${escapeForDiff(o.text)}</span></div>`;
  }).join('');
}

/**
 * oldText + newText → { html, added, removed, ops, kind }
 * kind: 'new' | 'rewrite' | 'patch'
 */
export function diffView(oldText, newText, { collapseCtx = true, maxRows = 500 } = {}) {
  const hasOld = !!(oldText && String(oldText).length);
  const ops = computeLineDiff(oldText || '', newText || '');
  const stats = statsFromOps(ops);

  let renderOps = collapseCtx ? collapseContext(ops, 2) : ops;
  if (renderOps.length > maxRows) {
    renderOps = renderOps.slice(0, maxRows);
    renderOps.push({ type: 'sep', count: ops.length - maxRows });
  }

  let kind = 'patch';
  if (!hasOld) kind = 'new';
  else if (stats.removed > 40 && stats.added > 40) kind = 'rewrite';

  return {
    html: opsToHtml(renderOps),
    added: stats.added,
    removed: stats.removed,
    ops,
    kind
  };
}

/** @deprecated Styles in response.css only */
export const DIFF_ROW_CSS = '';