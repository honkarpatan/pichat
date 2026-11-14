// src/main/utils/message/MessagePart.js
//
// Single source of truth for an assistant turn: an ORDERED array of Parts.
// Replaces the old split of (botMessage: string) + (agentActions: Array),
// which never recorded true chronological order — ChatRenderer had to
// bucket-sort them back afterward (all reads → whole text glued together →
// all file diffs), which is exactly why order looked "ulto palta" and why
// a DOM crash mid-stream (see LiveChatUI.logAgentAction insertBefore bug)
// could silently drop everything after it.
//
// A 'tool' Part is intentionally shaped like the OLD action object
// (verb/target/fcName/entries/detail/fcArgs/...) so AgentActionUI's
// existing buildActionDetailsHtml()/actionSummary() work on it UNCHANGED.
// A 'file' Part is shaped to match what FileCards.fileCardHtml() expects.
// No HTML-generation code had to be rewritten — only re-ordered and
// unified behind one array.

export const PART_TYPE = {
  TEXT: 'text',
  TOOL: 'tool',
  FILE: 'file',
  PLAN: 'plan',   // sticky todo_write card (OpenCodeUI.planCardHtml)
  THINKING: 'thinking'  // Claude/OpenCode-style reasoning card
};

export const PART_STATUS = {
  RUNNING: 'running',     // tool call in flight
  STREAMING: 'streaming', // text or file still receiving chunks
  DONE: 'done',
  ERROR: 'error',
  SAVED: 'saved',         // file: write confirmed on disk
  REJECTED: 'rejected'    // file: user rejected in the confirm gate
};

const MAX_FILE_CONTENT = 500000;
const MAX_PREVIEW = 4000;
const MAX_ARGS_STR = 200;
const MAX_ENTRIES = 40;
const MAX_PARTS = 160;

let _seq = 0;
export function genId(prefix = 'p') {
  _seq = (_seq + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makePart(type, data = {}) {
  // IMPORTANT: put `id` LAST. If we set id first and then `...data`, an
  // explicit `id: undefined` from callers like makeTextPart({ id: opts.id })
  // overwrites the generated id — scheduleUpsert/upsert then no-op because
  // they require part.id, so normal-chat prose never paints to the DOM.
  return {
    status: PART_STATUS.DONE,
    createdAt: Date.now(),
    ...data,
    type,
    id: data.id || genId(type[0])
  };
}

export function makeTextPart(text = '', opts = {}) {
  return makePart(PART_TYPE.TEXT, {
    id: opts.id,
    text,
    status: opts.status || PART_STATUS.STREAMING
  });
}

/** Shape mirrors the legacy "action" object on purpose — see header note. */
export function makeToolPart(data = {}) {
  return makePart(PART_TYPE.TOOL, {
    id: data.id,
    status: data.status || PART_STATUS.RUNNING,
    verb: data.verb || '',
    target: data.target || data.label || '',
    label: data.label || data.target || '',
    fcName: data.fcName || '',
    kind: data.kind || null,
    entries: data.entries || null,
    detail: data.detail || null,
    fcArgs: data.fcArgs || null,
    fullPath: data.fullPath || '',
    path: data.path || data.fullPath || '',
    url: data.url || null,
    readRanges: data.readRanges || null,
    editRanges: data.editRanges || null,
    addRanges: data.addRanges || null,
    removeRanges: data.removeRanges || null,
    addRanges: data.addRanges || null,
    removeRanges: data.removeRanges || null,
    fileTotalLines: data.fileTotalLines || 0
  });
}

/** Shape mirrors what FileCards.fileCardHtml()/diffView() expect. */
export function makeFilePart(data = {}) {
  return makePart(PART_TYPE.FILE, {
    id: data.id,
    status: data.status || PART_STATUS.STREAMING,
    path: data.path || data.label || data.target || '',
    oldContent: data.oldContent != null ? data.oldContent : '',
    newContent: data.newContent != null ? data.newContent : (data.content != null ? data.content : ''),
    lang: data.lang || '',
    verb: data.verb || '',
    fcName: data.fcName || 'create_or_update_file',
    url: data.url || null,
    editRanges: data.editRanges || null,
    addRanges: data.addRanges || null,
    removeRanges: data.removeRanges || null,
    readRanges: data.readRanges || null,
    fileTotalLines: data.fileTotalLines || 0,
    kind: data.kind || null
  });
}

/** Normalize model todo items → { text, status: pending|in_progress|done } */
export function normalizePlanItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((it) => {
      if (it == null) return null;
      if (typeof it === 'string') {
        return { text: it.trim(), status: 'pending' };
      }
      const text = String(it.text || it.content || it.title || it.task || '').trim();
      if (!text) return null;
      return { text, status: normalizePlanStatus(it.status) };
    })
    .filter(Boolean);
}

function normalizePlanStatus(s) {
  const v = String(s || 'pending').toLowerCase().replace(/[\s-]+/g, '_');
  if (v === 'done' || v === 'completed' || v === 'complete' || v === 'finished') return 'done';
  if (v === 'in_progress' || v === 'running' || v === 'active' || v === 'doing') return 'in_progress';
  return 'pending';
}

/** Sticky plan card part (todo_write). */
export function makePlanPart(items, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  return makePart(PART_TYPE.PLAN, {
    id: opts.id || 'plan',
    items: list,
    status: opts.status || PART_STATUS.RUNNING,
    fcName: 'todo_write',
    verb: 'Plan'
  });
}

// ---------------------------------------------------------------------
// Streaming mutators — these are what give "flash on the CURRENT step
// only, previous steps stay put" instead of the old floating typing-dot.
// ---------------------------------------------------------------------

function findById(parts, id) {
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].id === id) return i;
  return -1;
}

/**
 * Append a streamed chunk to the trailing TEXT part, or start a new one.
 * Only the LAST part (if it's text AND still streaming) gets extended —
 * so text that arrives after a tool/file part always starts a fresh part,
 * keeping text1 → tool1 → text2 → file1 in true arrival order instead of
 * being stitched into one giant string at the very end.
 */
/**
 * Common complete English words that often end a stream before a tool row.
 * When lastWord is one of these, prefer a space join ("to"+"see" → "to see")
 * instead of mid-word glue ("tosee").
 */
const COMPLETE_WORDS = new Set([
  "i'm", "i’m", "you're", "don't", "can't", "won't", "it's", "that's", "we're", "they're", "i've", "i'll", "here", "assist", "today",
  'a', 'i', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it',
  'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we',
  'and', 'the', 'for', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one',
  'our', 'out', 'are', 'but', 'his', 'how', 'its', 'let', 'may', 'new', 'now',
  'old', 'see', 'way', 'who', 'did', 'get', 'has', 'him', 'say', 'she', 'too',
  'use', 'any', 'few', 'own', 'also', 'back', 'been', 'call', 'come', 'each',
  'even', 'from', 'give', 'good', 'have', 'here', 'into', 'just', 'know',
  'like', 'long', 'look', 'made', 'make', 'many', 'more', 'most', 'much',
  'must', 'name', 'need', 'next', 'only', 'over', 'part', 'read', 'same',
  'some', 'such', 'take', 'than', 'that', 'them', 'then', 'they', 'this',
  'time', 'very', 'want', 'well', 'were', 'what', 'when', 'will', 'with',
  'work', 'your', 'file', 'code', 'line', 'step', 'plan', 'task', 'rest'
]);

/**
 * Append streamed text. Returns the text part that was written/merged so the
 * caller can re-paint it (merge may target an earlier part across tool rows).
 */
export function appendTextChunk(parts, chunk, opts = {}) {
  if (!chunk) return null;
  const last = parts[parts.length - 1];
  if (last && last.type === PART_TYPE.TEXT && last.status === PART_STATUS.STREAMING) {
    last.text += chunk;
    return last;
  }

  const next = String(chunk);
  const nextTrimStart = next.replace(/^\s+/, '');
  if (!nextTrimStart) {
    const part = makeTextPart(chunk, { id: opts.id, status: PART_STATUS.STREAMING });
    parts.push(part);
    return part;
  }

  // Find nearest prior text part (may skip trailing tool/file rows)
  let textIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p) continue;
    if (p.type === PART_TYPE.TEXT) {
      textIdx = i;
      break;
    }
    if (p.type !== PART_TYPE.TOOL && p.type !== PART_TYPE.FILE && p.type !== PART_TYPE.PLAN) {
      break;
    }
  }

  if (textIdx >= 0) {
    const textPart = parts[textIdx];
    const prev = String(textPart.text || '');
    const prevTrimEnd = prev.replace(/\s+$/, '');
    const lastWord = (prevTrimEnd.split(/\s+/).pop() || '');
    const lastWordLower = lastWord.toLowerCase();
    const crossedTool = textIdx < parts.length - 1;

    // A) True mid-word cut: "...curr"+"ent", "...suppo"+"rt"
    //    Never glue complete words / contractions ("I'm"+"here" → "I'm here").
    const nextToken = (nextTrimStart.split(/\s+/)[0] || '').replace(/[^A-Za-z0-9'].*$/, '');
    const isContraction = /'/.test(lastWord) || /^(i'm|i’m|you're|you’re|don't|don’t|can't|can’t|won't|won’t|it's|it’s|that's|that’s|we're|we’re|they're|they’re|i've|i’ve|i'll|i’ll)$/i.test(lastWordLower);
    // Suffix-like continuation of a broken token (ent, ing, tion, ment…)
    const looksLikeSuffix = nextToken.length > 0 && nextToken.length <= 4 && /^[a-z]+$/i.test(nextToken);
    const midWord =
      /[A-Za-z0-9]$/.test(prevTrimEnd) &&
      /^[a-z0-9]/.test(nextTrimStart) &&
      !/\s/.test(prev.slice(-1)) &&
      lastWord.length > 0 &&
      !COMPLETE_WORDS.has(lastWordLower) &&
      !isContraction &&
      // Prefer merge only when it looks like a stream-split token, not two full words
      (lastWord.length <= 5 || looksLikeSuffix) &&
      !(nextToken.length >= 4 && lastWord.length >= 3 && !looksLikeSuffix);

    // B) Sentence continue across tool rows: "to see" + tool + "its structure."
    //    Also after sealed text (DONE) even if last part is still the text row:
    //    "…and updated" + "project memory." (api-key row sealed mid-sentence)
    const sentenceContinue =
      prevTrimEnd.length > 0 &&
      !/[.!?…]$/.test(prevTrimEnd) &&
      /^[a-z0-9]/.test(nextTrimStart) &&
      lastWord.length >= 1 &&
      (crossedTool || textPart.status === PART_STATUS.DONE);

    // C) List/outline continuation across Answered/tool rows:
    //    "...setupTouchListeners:" + [Answered] + "Lines 1516–1545"
    const listContinue =
      crossedTool &&
      prevTrimEnd.length > 0 &&
      (
        /:\s*$/.test(prevTrimEnd) ||
        /`[^`]+`\s*:\s*$/.test(prevTrimEnd) ||
        /-\s*`[^`]+`\s*:\s*$/.test(prevTrimEnd) ||
        /[A-Za-z_$][\w$]*\s*:\s*$/.test(prevTrimEnd)
      ) &&
      (
        /^(Lines?\s+\d|L\d|\d+\s*[–\-−]\s*\d)/i.test(nextTrimStart) ||
        /^`?[A-Za-z_$]/.test(nextTrimStart)
      );

    if (midWord) {
      const merged = prevTrimEnd + nextTrimStart;
      try {
        console.log('[TextPart] midWordMerge', {
          prevTail: prevTrimEnd.slice(-40),
          nextHead: nextTrimStart.slice(0, 40),
          crossedTool,
          lastWord
        });
      } catch (_) {}
      textPart.text = merged;
      return textPart;
    }

    if (listContinue) {
      const needsSpace = !/\s$/.test(prevTrimEnd) && !/^\s/.test(nextTrimStart) && !/:$/.test(prevTrimEnd);
      // Keep "name:" + " Lines …" readable; colon already present
      const merged = /:\s*$/.test(prevTrimEnd)
        ? (prevTrimEnd + (/^\s/.test(nextTrimStart) ? '' : ' ') + nextTrimStart)
        : (prevTrimEnd + (needsSpace ? ' ' : '') + nextTrimStart);
      try {
        console.log('[TextPart] listContinueMerge', {
          prevTail: prevTrimEnd.slice(-50),
          nextHead: nextTrimStart.slice(0, 40),
          crossedTool: true
        });
      } catch (_) {}
      textPart.text = merged;
      return textPart;
    }

    if (sentenceContinue) {
      const merged = prevTrimEnd + ' ' + nextTrimStart;
      try {
        console.log('[TextPart] sentenceMergeAcrossTool', {
          prevTail: prevTrimEnd.slice(-50),
          nextHead: nextTrimStart.slice(0, 50),
          toolsBetween: parts.length - 1 - textIdx
        });
      } catch (_) {}
      textPart.text = merged;
      return textPart;
    }
  }

  try {
    const prevTail = last && last.type === PART_TYPE.TEXT
      ? String(last.text || '').slice(-30)
      : (last ? `${last.type}:${last.verb || last.name || ''}` : 'none');
    console.log('[TextPart] newTextPart', {
      prevTail,
      nextHead: nextTrimStart.slice(0, 40),
      lastType: last?.type || null,
      partsLen: parts.length
    });
  } catch (_) {}

  const part = makeTextPart(chunk, { id: opts.id, status: PART_STATUS.STREAMING });
  parts.push(part);
  return part;
}

export function sealStreamingText(parts, reason = '') {
  const last = parts[parts.length - 1];
  if (last && last.type === PART_TYPE.TEXT && last.status === PART_STATUS.STREAMING) {
    last.status = PART_STATUS.DONE;
    try {
      console.log('[TextPart] seal', {
        reason: reason || 'unspecified',
        tail: String(last.text || '').slice(-50),
        len: String(last.text || '').length
      });
    } catch (_) {}
    return last;
  }
  return null;
}

/**
 * Insert a new tool part, or patch an existing one in place by id
 * (running → done/error transition uses the SAME id, same array slot —
 * never a new element, never a reorder).
 * Seals any in-flight streaming text first, so this step lands after the
 * prose that led up to it rather than interrupting it mid-sentence.
 */
// return shape বদলে গেল: { part, sealed }

/**
 * Merge section-reads of the same file into ONE tool row with coverage ranges.
 * Edit of same file resets read coverage (new session after mutation).
 */
export function upsertReadCoveragePart(parts, data) {
  const sealed = sealStreamingText(parts, `tool:read-coverage`);
  const base = String(data.path || data.target || data.label || '')
    .split(/[/\\]/).filter(Boolean).pop()?.toLowerCase() || '';
  const range = data.readRange || null;

  // Find existing open/done read-coverage row for this basename (after last edit of same file)
  let idx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p) continue;
    if (p.type === PART_TYPE.FILE) {
      const pb = String(p.path || p.label || p.target || '').split(/[/\\]/).filter(Boolean).pop()?.toLowerCase() || '';
      if (pb && pb === base) {
        // File was edited after last read group — start fresh read row
        break;
      }
      continue;
    }
    if (p.type !== PART_TYPE.TOOL) continue;
    const isRead = p.fcName === 'read' || p.fcName === 'read_file' ||
      /read/i.test(String(p.verb || ''));
    if (!isRead) continue;
    const pb = String(p.path || p.label || p.target || '').split(/[/\\]/).filter(Boolean).pop()?.toLowerCase() || '';
    if (pb && pb === base) {
      idx = i;
      break;
    }
  }

  if (idx === -1) {
    const part = makeToolPart({
      ...data,
      kind: 'file-coverage',
      readRanges: range ? [range] : [],
      editRanges: [],
      // Prefer real file length; never use range.end as "total" if total is larger later
      fileTotalLines: Math.max(Number(data.fileTotalLines) || 0, range ? range.end : 0),
      path: data.path || data.target || base,
      target: data.target || base,
      label: data.label || base
    });
    parts.push(part);
    return { part, sealed };
  }

  const prev = parts[idx];
  const ranges = Array.isArray(prev.readRanges) ? [...prev.readRanges] : [];
  if (range) ranges.push(range);
  // dynamic import avoided — merge inline simple
  const merged = ranges.slice().sort((a, b) => a.start - b.start);
  const compact = [];
  for (const r of merged) {
    if (!compact.length || r.start > compact[compact.length - 1].end + 1) {
      compact.push({ start: r.start, end: r.end });
    } else {
      compact[compact.length - 1].end = Math.max(compact[compact.length - 1].end, r.end);
    }
  }
  // Scale track to real file size when known (e.g. 709), not last-read end (165)
  const knownTotal = Math.max(
    Number(prev.fileTotalLines) || 0,
    Number(data.fileTotalLines) || 0
  );
  const maxRangeEnd = Math.max(
    range ? range.end : 0,
    ...compact.map(r => Number(r.end) || 0),
    0
  );
  // If knownTotal looks like a real file length (>= max range), keep it;
  // if we only ever saw range ends, fall back to maxRangeEnd.
  const total = knownTotal >= maxRangeEnd ? Math.max(knownTotal, 1) : Math.max(maxRangeEnd, knownTotal, 1);
  const part = makeToolPart({
    ...prev,
    ...data,
    id: prev.id,
    kind: 'file-coverage',
    readRanges: compact,
    editRanges: prev.editRanges || [],
    fileTotalLines: total,
    path: prev.path || data.path || base,
    target: data.target || prev.target || base,
    label: data.label || prev.label || base,
    status: data.status || prev.status
  });
  parts[idx] = part;
  return { part, sealed };
}

export function upsertToolPart(parts, data) {
  // Status / meta rows must NOT seal mid-sentence prose
  // (e.g. "Tried with key" / rate-limit) — that split "updated" | "project memory."
  const kind = String(data.kind || data.fcName || '');
  const verb = String(data.verb || '');
  const isMetaStatus =
    kind === 'status' ||
    kind === 'api-key-failover' ||
    data.fcName === 'api_key_failover' ||
    data.fcName === 'rate_limit_retry' ||
    /^Tried with\b/i.test(verb) ||
    /^Retry/i.test(verb) ||
    data.id === 'api-key-failover' ||
    String(data.id || '').startsWith('api-key');

  const sealed = isMetaStatus
    ? null
    : sealStreamingText(parts, `tool:${data.verb || data.fcName || data.name || "tool"}`);
  let idx = data.id ? findById(parts, data.id) : -1;

  // Explore (running) → Explored (done): same target / subagent, even if id drifted
  if (idx === -1 && (data.fcName === 'subagent' || /^explor/i.test(String(data.verb || '')))) {
    const tgt = String(data.target || data.label || '').toLowerCase();
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.type !== PART_TYPE.TOOL) continue;
      if (p.fcName !== 'subagent' && !/^explor/i.test(String(p.verb || ''))) continue;
      const pt = String(p.target || p.label || '').toLowerCase();
      if (tgt && pt && tgt === pt &&
          (p.status === PART_STATUS.RUNNING || p.status === PART_STATUS.STREAMING)) {
        idx = i;
        break;
      }
    }
  }

  let part;
  if (idx === -1) { part = makeToolPart(data); parts.push(part); }
  else { part = makeToolPart({ ...parts[idx], ...data, id: parts[idx].id }); parts[idx] = part; }
  return { part, sealed };
}

/**
 * One file card per logical write. Prefer matching:
 * 1) exact id
 * 2) stream placeholder for same basename (stream-… → real tool id)
 * so "Writing game.js" upgrades in place to "Edited game.js" — never 3 rows.
 */
export function upsertFilePart(parts, data) {
  const sealed = sealStreamingText(parts, `file:${data.path || data.label || ""}`);
  const pathKey = String(data.path || data.label || data.target || '')
    .split(/[/\\]/).filter(Boolean).pop()
    ?.toLowerCase() || '';

  let idx = data.id ? findById(parts, data.id) : -1;

  // Reuse in-flight stream card OR any open file row for the same basename
  // so Writing → Created is ONE row (never stack stream-running + final).
  if (idx === -1 && pathKey) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.type !== PART_TYPE.FILE && p.type !== PART_TYPE.TOOL) continue;
      const pPath = String(p.path || p.label || p.target || '')
        .split(/[/\\]/).filter(Boolean).pop()
        ?.toLowerCase() || '';
      if (!pPath || pPath !== pathKey) continue;
      const isStream = String(p.id || '').startsWith('stream-');
      const open = p.status === PART_STATUS.STREAMING || p.status === PART_STATUS.RUNNING;
      // Prefer stream/open; also reclaim stream-* even if already marked done (race)
      if (isStream || open) {
        idx = i;
        break;
      }
    }
  }
  // Still no match: last file part with same path (final overwrite of same file this turn)
  if (idx === -1 && pathKey) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.type !== PART_TYPE.FILE) continue;
      const pPath = String(p.path || p.label || p.target || '')
        .split(/[/\\]/).filter(Boolean).pop()
        ?.toLowerCase() || '';
      if (pPath === pathKey) {
        idx = i;
        break;
      }
    }
  }

  let part;
  if (idx === -1) {
    part = makeFilePart(data);
    parts.push(part);
  } else {
    const prev = parts[idx];
    // CRITICAL: keep the same id so PartsRenderer.map updates in place
    // Multi-edit same file: keep FIRST oldContent + LATEST newContent; merge ranges
    const keepOld = prev.oldContent != null ? prev.oldContent
      : (data.oldContent != null ? data.oldContent : null);
    const keepNew = data.newContent != null ? data.newContent : prev.newContent;

    const mergeRangeLists = (a, b) => {
      const list = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]
        .map(r => ({ start: Number(r.start) || 1, end: Number(r.end) || Number(r.start) || 1 }))
        .filter(r => r.end >= r.start)
        .sort((x, y) => x.start - y.start || x.end - y.end);
      if (!list.length) return [];
      const out = [{ ...list[0] }];
      for (let i = 1; i < list.length; i++) {
        const cur = list[i];
        const last = out[out.length - 1];
        if (cur.start <= last.end + 1) last.end = Math.max(last.end, cur.end);
        else out.push({ ...cur });
      }
      return out;
    };

    let addRanges = mergeRangeLists(prev.addRanges, data.addRanges);
    let removeRanges = mergeRangeLists(prev.removeRanges, data.removeRanges);
    let editRanges = mergeRangeLists(prev.editRanges, data.editRanges);

    // Prefer recompute from cumulative old→new so multi-hunk (3–40, 130–165, …) is accurate
    if (keepOld != null && keepNew != null) {
      try {
        // dynamic-free: simple line marker via content lengths only as fallback;
        // OpenCodeUI recompute uses rangesFromFullFileDiff at paint time when texts present
        const nOld = String(keepOld).split(/\n/).length;
        const nNew = String(keepNew).split(/\n/).length;
        const total = Math.max(nOld, nNew, Number(prev.fileTotalLines) || 0, Number(data.fileTotalLines) || 0, 1);
        part = makeFilePart({
          ...prev,
          ...data,
          id: prev.id,
          path: data.path || prev.path,
          oldContent: keepOld,
          newContent: keepNew,
          addRanges: addRanges.length ? addRanges : (data.addRanges || prev.addRanges || null),
          removeRanges: removeRanges.length ? removeRanges : (data.removeRanges || prev.removeRanges || null),
          editRanges: editRanges.length ? editRanges : (data.editRanges || prev.editRanges || null),
          fileTotalLines: total,
          fcArgs: data.fcArgs || prev.fcArgs || null
        });
      } catch (_) {
        part = makeFilePart({
          ...prev,
          ...data,
          id: prev.id,
          path: data.path || prev.path,
          oldContent: keepOld,
          newContent: keepNew,
          addRanges,
          removeRanges,
          editRanges
        });
      }
    } else {
      part = makeFilePart({
        ...prev,
        ...data,
        id: prev.id,
        path: data.path || prev.path,
        oldContent: keepOld,
        newContent: keepNew,
        addRanges: addRanges.length ? addRanges : data.addRanges || prev.addRanges,
        removeRanges: removeRanges.length ? removeRanges : data.removeRanges || prev.removeRanges,
        editRanges: editRanges.length ? editRanges : data.editRanges || prev.editRanges
      });
    }
    parts[idx] = part;

    // Drop any OTHER stream/running duplicates for the same file
    for (let i = parts.length - 1; i >= 0; i--) {
      if (i === idx) continue;
      const p = parts[i];
      if (p.type !== PART_TYPE.FILE && p.type !== PART_TYPE.TOOL) continue;
      const pPath = String(p.path || p.label || p.target || '')
        .split(/[/\\]/).filter(Boolean).pop()
        ?.toLowerCase() || '';
      if (pPath !== pathKey) continue;
      if (String(p.id || '').startsWith('stream-') ||
          p.status === PART_STATUS.STREAMING || p.status === PART_STATUS.RUNNING) {
        parts.splice(i, 1);
        if (i < idx) idx--;
      }
    }
  }
  return { part, sealed };
}


/** Reasoning / extended-thinking part (Plan 3). */
export function makeThinkingPart(data = {}) {
  return makePart(PART_TYPE.THINKING, {
    id: data.id || 'thinking',
    text: data.text != null ? String(data.text) : '',
    status: data.status || PART_STATUS.STREAMING,
    signature: data.signature || null,
    redactedData: data.redactedData || null,
    provider: data.provider || null,
    startedAt: data.startedAt || Date.now(),
    endedAt: data.endedAt != null ? data.endedAt : null,
    simulated: !!data.simulated
  });
}

/**
 * Append reasoning delta into parts[]. Seals streaming text first.
 * @returns {{ part, sealed }}
 */
export function appendThinkingDelta(parts, delta, opts = {}) {
  const sealed = sealStreamingText(parts);
  const id = opts.id || 'thinking';
  const chunk = String(delta || '');
  let idx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]?.id === id && parts[i].type === PART_TYPE.THINKING) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    const part = makeThinkingPart({
      id,
      text: chunk,
      status: PART_STATUS.STREAMING,
      provider: opts.provider,
      startedAt: opts.startedAt || Date.now()
    });
    parts.push(part);
    return { part, sealed };
  }
  const prev = parts[idx];
  const next = {
    ...prev,
    text: String(prev.text || '') + chunk,
    status: PART_STATUS.STREAMING,
    provider: opts.provider || prev.provider
  };
  parts[idx] = next;
  return { part: next, sealed };
}

/**
 * Mark thinking part complete (collapse-ready).
 */
export function finalizeThinkingPart(parts, opts = {}) {
  const id = opts.id || 'thinking';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p?.type === PART_TYPE.THINKING && p.id === id) {
      parts[i] = {
        ...p,
        status: opts.redacted ? PART_STATUS.DONE : (opts.status || PART_STATUS.DONE),
        endedAt: opts.endedAt || Date.now(),
        signature: opts.signature != null ? opts.signature : p.signature,
        redactedData: opts.redactedData != null ? opts.redactedData : p.redactedData,
        text: opts.redacted && !p.text
          ? ''
          : p.text
      };
      if (opts.redacted) parts[i].status = PART_STATUS.DONE;
      return { part: parts[i] };
    }
  }
  return { part: null };
}

export function upsertThinkingPart(parts, data = {}) {
  const sealed = sealStreamingText(parts);
  const id = data.id || 'thinking';
  let idx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]?.id === id && parts[i].type === PART_TYPE.THINKING) {
      idx = i;
      break;
    }
  }
  const part = makeThinkingPart({
    ...(idx >= 0 ? parts[idx] : {}),
    ...data,
    id
  });
  if (idx === -1) parts.push(part);
  else parts[idx] = part;
  return { part, sealed };
}

export function upsertPlanPart(parts, items, opts = {}) {
  const sealed = sealStreamingText(parts);
  const id = opts.id || 'plan';
  const idx = findById(parts, id);
  const norm = normalizePlanItems(items);
  const allDone = norm.length > 0 && norm.every(it => it.status === 'done');
  const part = makePlanPart(norm, { id, status: allDone ? PART_STATUS.DONE : PART_STATUS.RUNNING });
  if (idx === -1) parts.push(part); else parts[idx] = part;
  return { part, sealed };
}

// ---------------------------------------------------------------------
// Persistence: trim + de-dup, order untouched
// ---------------------------------------------------------------------

function isWebPart(p) {
  return p.type === PART_TYPE.TOOL && (p.kind === 'web' || p.fcName === 'web_search');
}

/** Same rule AgentActionUI.isInternalAction used, duplicated here on
 *  purpose to keep MessagePart.js dependency-free (pure data module,
 *  safe to import from anywhere — no DOM, no other utils). Keep these
 *  two definitions in sync if the verb list ever changes. */
function isInternalToolPart(p) {
  if (p.type !== PART_TYPE.TOOL) return false;
  const v = String(p.verb || p.target || '');
  return /^(Nudge|Pipeline|Codegen|Tools|Force|Re-?init|Emit|Intercept|Continue|Re-initializ)/i.test(v)
    || /force write|must write|file= code|full source \(no tools\)/i.test(v);
}

/**
 * Trim + de-dup for storage. NEVER reorders — only drops internal/system
 * noise, collapses consecutive duplicate "Read x" steps, keeps the
 * richest of duplicate web-search parts, and caps oversized content.
 * Analogous to AgentTimeline.compactActions, but works on the unified
 * Part[] instead of a side-channel actions array.
 */
export function compactParts(parts) {
  if (!Array.isArray(parts)) return [];
  const out = [];
  let keptWeb = false;

  for (const raw of parts) {
    if (!raw) continue;
    if (isInternalToolPart(raw)) continue;
    if (raw.type === PART_TYPE.TEXT && !String(raw.text || '').trim()) continue;
    if (raw.type === PART_TYPE.THINKING &&
        !String(raw.text || '').trim() &&
        !raw.signature &&
        !raw.redactedData) continue;

    if (isWebPart(raw)) {
      if (keptWeb) {
        const prevIdx = out.findIndex(isWebPart);
        if (prevIdx >= 0) {
          const prevN = out[prevIdx].entries?.length || 0;
          const nextN = raw.entries?.length || 0;
          if (nextN > prevN) out[prevIdx] = raw;
        }
        continue;
      }
      keptWeb = true;
    }

    if (raw.type === PART_TYPE.TOOL && raw.verb === 'Read' && out.length) {
      const prev = out[out.length - 1];
      if (prev.type === PART_TYPE.TOOL && prev.verb === 'Read'
        && (prev.label || prev.target) === (raw.label || raw.target)) {
        continue;
      }
    }

    out.push(_capPartSize(raw));
    if (out.length >= MAX_PARTS) break;
  }
  return out;
}

function _capPartSize(part) {
  const p = { ...part };
  if (p.type === PART_TYPE.FILE) {
    if (p.oldContent) p.oldContent = String(p.oldContent).slice(0, MAX_FILE_CONTENT);
    if (p.newContent) p.newContent = String(p.newContent).slice(0, MAX_FILE_CONTENT);
    return p;
  }
  if (p.type === PART_TYPE.TOOL) {
    if (p.detail) p.detail = String(p.detail).slice(0, MAX_PREVIEW);
    if (p.entries?.length) p.entries = p.entries.slice(0, MAX_ENTRIES);
    if (p.fcArgs) {
      const slim = {};
      if (p.fcArgs.command) slim.command = String(p.fcArgs.command).slice(0, MAX_ARGS_STR);
      if (p.fcArgs.path) slim.path = String(p.fcArgs.path).slice(0, 160);
      p.fcArgs = Object.keys(slim).length ? slim : null;
    }
    return p;
  }
  return p; // text parts are the user-facing reply — never truncate silently
}

// ---------------------------------------------------------------------
// Legacy migration — old chats saved before this change have
// { content: string, agentActions: [] }, not { parts: [] }.
// ---------------------------------------------------------------------

/**
 * Best-effort upgrade of an old-shaped message into parts[].
 * Old data never recorded true interleave, so this reconstructs the same
 * approximation the old renderer always showed (reads first, one text
 * blob, then file cards) — just expressed as Parts, so the renderer only
 * needs ONE code path instead of a "legacy vs new" branch everywhere.
 */
export function partsFromLegacyMessage(msg) {
  if (Array.isArray(msg?.parts)) return msg.parts; // already migrated
  const parts = [];
  const acts = Array.isArray(msg?.agentActions) ? msg.agentActions : [];
  const isWrite = (a) =>
    a.fcName === 'create_or_update_file' || a.fcName === 'search_replace_edit' ||
    a.fcName === 'edit_file_lines' || a.fcName === 'create_file_tree' ||
    /^(Saved|Save failed|Wrote|Writing|Updated|Patch|Edited)/i.test(String(a.verb || ''));

  acts.filter(a => a && !isWrite(a)).forEach(a => {
    parts.push(makeToolPart({ ...a, status: a.status === 'error' ? PART_STATUS.ERROR : PART_STATUS.DONE }));
  });

  const text = typeof msg?.content === 'string' ? msg.content : '';
  if (text.trim()) parts.push(makeTextPart(text, { status: PART_STATUS.DONE }));

  acts.filter(a => a && isWrite(a)).forEach(a => {
    if (Array.isArray(a.appliedFiles) && a.appliedFiles.length) {
      a.appliedFiles.forEach(f => parts.push(makeFilePart({
        ...a, ...f, status: a.status === 'error' ? PART_STATUS.ERROR : PART_STATUS.SAVED
      })));
    } else if (a.newContent != null || a.content != null) {
      parts.push(makeFilePart({ ...a, status: a.status === 'error' ? PART_STATUS.ERROR : PART_STATUS.SAVED }));
    }
  });

  return parts;
}

/** Convenience: parts[] for any message shape, old or new. */
export function getMessageParts(msg) {
  return Array.isArray(msg?.parts) ? msg.parts : partsFromLegacyMessage(msg);
}