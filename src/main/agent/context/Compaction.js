/**
 * Context compaction (Pi Durable idea — extractive, no extra model call).
 * M1: digests keep path + line ranges + anchors so the model does not re-read after compact.
 */

import { ConfigManager } from '../../utils/ConfigManager.js';

const TAG = '[Compaction]';

/** Rough token estimate (~4 chars / token). Tool results counted more honestly for budget. */
export function estimateTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const m of messages) {
    if (!m) continue;
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (typeof c === 'string') chars += c.length;
        else if (c?.text) chars += String(c.text).length;
        else if (c?.functionResponse) {
          try {
            // M1: do not under-count huge tool bodies (was capped 2000 → late compact)
            chars += Math.min(12000, JSON.stringify(c.functionResponse).length);
          } catch (_) { chars += 400; }
        } else if (c?.functionCall) {
          try { chars += Math.min(2000, JSON.stringify(c.functionCall).length); } catch (_) { chars += 150; }
        } else {
          try { chars += Math.min(1200, JSON.stringify(c).length); } catch (_) {}
        }
      }
    } else {
      try { chars += Math.min(1200, JSON.stringify(m.content).length); } catch (_) {}
    }
  }
  return Math.ceil(chars / 4);
}

function baseName(p) {
  return String(p || '').split(/[/\\]/).filter(Boolean).pop() || String(p || '');
}

/** Pull anchors from file content snippet (HTML/JS/CSS landmarks). */
function extractAnchors(text, max = 6) {
  const s = String(text || '');
  if (!s) return [];
  const found = [];
  const patterns = [
    /<style\b[^>]*>/gi,
    /<\/style>/gi,
    /<script\b[^>]*>/gi,
    /id=["']([^"']+)["']/gi,
    /class=["']([^"']+)["']/gi,
    /\.([a-zA-Z_][\w-]*)\s*\{/g,
    /function\s+([a-zA-Z_]\w*)/g,
    /(?:const|let|var)\s+([a-zA-Z_]\w*)\s*=/g
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

function digestFunctionResponse(name, response) {
  const r = response || {};
  if (r.error) {
    return `← ${name} ERR: ${String(r.error).slice(0, 80)}`;
  }

  // read / read_file
  if (name === 'read' || name === 'read_file') {
    const path = baseName(r.path || r.file || r.filename || '');
    const range = r.range || (r.start_line != null ? `${r.start_line}-${r.end_line || ''}` : '');
    const total = r.totalLines || r.total_lines || '';
    const body = r.content || r.text || r.numbered || r.data || '';
    const anchors = extractAnchors(typeof body === 'string' ? body : '');
    const head = typeof body === 'string' ? body.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    let s = `← read ${path || 'file'}`;
    if (range) s += ` ${range}`;
    if (total) s += ` of ~${total}`;
    if (anchors.length) s += `: ${anchors.slice(0, 4).join('; ')}`;
    else if (head) s += `: ${head}`;
    return s.slice(0, 200);
  }

  if (name === 'grep' || name === 'glob' || name === 'list_directory' || name === 'outline') {
    const n = Array.isArray(r.entries) ? r.entries.length
      : Array.isArray(r.matches) ? r.matches.length
      : Array.isArray(r.files) ? r.files.length
      : (r.count != null ? r.count : '');
    const path = baseName(r.path || r.pattern || '');
    return `← ${name}${path ? ' ' + path : ''}${n !== '' ? ` (${n})` : ' ok'}`.slice(0, 160);
  }

  if (/write|str_replace|edit_file|create_|delete|update_project|apply_patch|multi_edit/i.test(name)) {
    const path = baseName(r.path || r.file || '');
    return `← ${name}${path ? ' ' + path : ''} ok`.slice(0, 160);
  }

  const ok = r.success !== false && !r.error;
  return `← ${name}${ok ? ' ok' : ' err'}`.slice(0, 120);
}

function msgSnippet(m, max = 220) {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content.trim().slice(0, max);
  if (!Array.isArray(m.content)) return '';
  const bits = [];
  for (const c of m.content) {
    if (c?.text) {
      const t = String(c.text).trim();
      // Skip pure [SYSTEM: ...] noise in digest lines
      if (t.startsWith('[SYSTEM')) continue;
      bits.push(t.slice(0, 80));
    }
    if (c?.functionCall?.name) {
      const args = c.functionCall.args || c.functionCall.arguments || {};
      let argHint = '';
      try {
        const a = typeof args === 'string' ? JSON.parse(args) : args;
        if (a?.path) argHint = ' ' + baseName(a.path);
        if (a?.start_line != null) argHint += ` ${a.start_line}-${a.end_line || ''}`;
        if (a?.pattern) argHint += ' ' + String(a.pattern).slice(0, 30);
      } catch (_) {}
      bits.push(`→ ${c.functionCall.name}${argHint}`);
    }
    if (c?.functionResponse?.name) {
      bits.push(digestFunctionResponse(c.functionResponse.name, c.functionResponse.response));
    }
  }
  return bits.join(' · ').slice(0, max);
}

/**
 * Build a short extractive summary of intermediate messages — keeps evidence.
 */
export function summarizeMiddle(middle) {
  const lines = [];
  let tools = 0;
  let writes = 0;
  const readDigests = [];

  for (const m of middle) {
    if (!Array.isArray(m?.content)) continue;
    for (const c of m.content) {
      const name = c?.functionCall?.name || c?.functionResponse?.name;
      if (!name) continue;
      tools++;
      if (/write|str_replace|edit_file|create_|delete|update_project|apply_patch|multi_edit/i.test(name)) writes++;

      if (c?.functionResponse && (name === 'read' || name === 'read_file')) {
        const d = digestFunctionResponse(name, c.functionResponse.response);
        if (d && readDigests.length < 10 && !readDigests.includes(d)) readDigests.push(d);
      }

      if (lines.length < 14) {
        const sn = msgSnippet(m, 180);
        if (sn && !lines.includes(`- ${sn}`)) lines.push(`- ${sn}`);
      }
    }
  }

  const evidence = readDigests.length
    ? `\nEvidence (do NOT re-read these ranges unless editing):\n${readDigests.map(d => `- ${d}`).join('\n')}\n`
    : '';

  return (
    `[SYSTEM: Context compacted. ~${tools} tool events (${writes} writes) summarized.\n` +
    `Keep the original user request. Prefer str_replace/edit_file_lines on files already read.\n` +
    evidence +
    (lines.length ? `Recent steps:\n${lines.join('\n')}` : '') +
    `]`
  );
}

/**
 * Compact working messages for the agent loop.
 * M1: prefer token pressure; message-count threshold raised so short reads are not wiped early.
 */
export function compactWorkingMessages(messages, baseCount, opts = {}) {
  if (!Array.isArray(messages)) {
    return { messages, compacted: false, beforeTokens: 0, afterTokens: 0, dropped: 0 };
  }

  const tokenBudget = opts.tokenBudget ??
    (ConfigManager.get('historyTokenBudget') != null
      ? parseInt(ConfigManager.get('historyTokenBudget'), 10)
      : 12000);
  // M1: was 16 → ~step 8 wipe; allow more messages unless tokens actually high
  const maxExtraMsgs = opts.maxExtraMsgs ?? 28;
  const keepTail = opts.keepTail ?? 12;

  const beforeTokens = estimateTokens(messages);
  const safeBase = Math.max(1, Math.min(baseCount || 1, messages.length));
  const extraCount = messages.length - safeBase;

  const overMsgs = extraCount > maxExtraMsgs;
  const overTokens = beforeTokens > tokenBudget;

  if (!overMsgs && !overTokens) {
    return { messages, compacted: false, beforeTokens, afterTokens: beforeTokens, dropped: 0 };
  }

  const head = messages.slice(0, safeBase);
  const tailN = overTokens ? Math.max(keepTail, 8) : keepTail;
  const tail = messages.slice(-Math.min(tailN, Math.max(0, messages.length - safeBase)));
  const middleStart = safeBase;
  const middleEnd = messages.length - tail.length;
  const middle = middleEnd > middleStart ? messages.slice(middleStart, middleEnd) : [];

  if (!middle.length) {
    return { messages, compacted: false, beforeTokens, afterTokens: beforeTokens, dropped: 0 };
  }

  let summaryText = summarizeMiddle(middle);
  if (opts.workingNotes) {
    summaryText = summaryText.replace(/\]$/, '') + '\n' + String(opts.workingNotes).trim() + '\n]';
  }
  const summaryMsg = {
    role: 'user',
    content: [{ text: summaryText }]
  };

  const next = [...head, summaryMsg, ...tail];
  const afterTokens = estimateTokens(next);
  console.log(TAG, `compacted ${middle.length} msgs, tokens ${beforeTokens} → ${afterTokens}`);
  return {
    messages: next,
    compacted: true,
    beforeTokens,
    afterTokens,
    dropped: middle.length
  };
}

/** Force-compact regardless of budget (for /compact) */
export function forceCompactWorkingMessages(messages, baseCount, opts = {}) {
  return compactWorkingMessages(messages, baseCount, {
    maxExtraMsgs: 0,
    keepTail: opts.keepTail ?? 8,
    tokenBudget: 1,
    ...opts
  });
}
