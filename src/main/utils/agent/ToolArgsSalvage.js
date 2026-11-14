/**
 * Salvage truncated tool-call JSON (esp. Mistral / OpenAI-compat when finish_reason=length).
 *
 * RULES:
 * - Never invent missing content by closing braces — that writes half-files.
 * - Salvage only COMPLETE JSON string values (content/search/replace).
 * - Tools with large string payloads (write, create_*, str_replace) refuse partial salvage.
 */

const TAG = '[ToolArgsSalvage]';

/** Tools whose args contain large code payloads — brace-close must NEVER invent content. */
const CONTENT_HEAVY_TOOLS = new Set([
  'write',
  'create_or_update_file',
  'create_file_tree',
  'str_replace',
  'search_replace_edit',
  'edit_file_lines',
  'update_project_memory'
]);

/**
 * Extract root path + complete file nodes from a broken create_file_tree args string.
 * Incomplete trailing content string is dropped (never partial).
 */
export function salvageCreateFileTreeArgs(raw) {
  const s = String(raw || '');
  if (!s.trim()) return null;

  let rootPath = '';
  const pathM = s.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (pathM) rootPath = pathM[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');

  const nodes = [];
  const fileRe = /"type"\s*:\s*"file"[\s\S]*?"name"\s*:\s*"((?:\\.|[^"\\])*)"[\s\S]*?"content"\s*:\s*"/g;
  let m;
  while ((m = fileRe.exec(s)) !== null) {
    const name = m[1].replace(/\\"/g, '"');
    const contentStart = m.index + m[0].length;
    const extracted = extractJsonString(s, contentStart);
    if (!extracted.ok) {
      // truncated — stop; do not include partial content
      console.warn(TAG, 'truncated content for', name, '— skipping incomplete node');
      break;
    }
    nodes.push({ type: 'file', name, content: extracted.value });
    fileRe.lastIndex = extracted.end;
  }

  if (!nodes.length) {
    // Single-file style: path + complete content only
    const cM = s.match(/"content"\s*:\s*"/);
    if (cM && rootPath) {
      const start = cM.index + cM[0].length;
      const extracted = extractJsonString(s, start);
      if (extracted.ok) {
        return {
          path: rootPath,
          nodes: [{ type: 'file', name: rootPath.split('/').pop() || 'file.txt', content: extracted.value }],
          _salvaged: true
        };
      }
    }
    return null;
  }

  console.log(TAG, 'salvaged', nodes.length, 'complete file(s) under', rootPath || '(no path)');
  return { path: rootPath, nodes, _salvaged: true };
}

/** Read a JSON string value starting at position (first char after opening quote). */
function extractJsonString(s, start) {
  let i = start;
  let out = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      if (i + 1 >= s.length) return { ok: false, value: out, end: i };
      const n = s[i + 1];
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === '"') out += '"';
      else if (n === '\\') out += '\\';
      else out += n;
      i += 2;
      continue;
    }
    if (ch === '"') {
      return { ok: true, value: out, end: i + 1 };
    }
    out += ch;
    i++;
  }
  return { ok: false, value: out, end: i };
}

/**
 * Detect whether raw looks like it was cut mid-string (odd quotes / unfinished content key).
 */
function looksTruncatedMidString(raw) {
  const s = String(raw || '');
  if (!s.trim()) return true;
  // Unclosed string after a content-like key is the danger case
  if (/"content"\s*:\s*"/.test(s) || /"replace"\s*:\s*"/.test(s) || /"search"\s*:\s*"/.test(s) || /"new_content"\s*:\s*"/.test(s) || /"text"\s*:\s*"/.test(s)) {
    // Walk from last occurrence of those keys
    const keys = ['"content"', '"replace"', '"search"', '"new_content"', '"text"'];
    let lastKeyIdx = -1;
    for (const k of keys) {
      const i = s.lastIndexOf(k);
      if (i > lastKeyIdx) lastKeyIdx = i;
    }
    if (lastKeyIdx >= 0) {
      const after = s.slice(lastKeyIdx);
      const colonQuote = after.match(/:\s*"/);
      if (colonQuote) {
        const start = lastKeyIdx + colonQuote.index + colonQuote[0].length;
        const extracted = extractJsonString(s, start);
        if (!extracted.ok) return true;
      }
    }
  }
  // Odd number of unescaped quotes overall is a weak signal
  const quoteCount = (s.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 === 1) return true;
  return false;
}

/**
 * Try to repair tool args JSON.
 * - Valid JSON → ok
 * - Content-heavy tools: never brace-close invent content; only salvage complete strings
 * - Other tools: mild brace close allowed if not mid-string
 */
export function repairToolArgs(name, argsString) {
  const raw = String(argsString || '');
  const toolName = String(name || '');

  try {
    return { ok: true, args: JSON.parse(raw) };
  } catch (_) {}

  const heavy = CONTENT_HEAVY_TOOLS.has(toolName);
  const midString = looksTruncatedMidString(raw);

  // For content-heavy tools OR mid-string truncation: NEVER close-braces invent content
  if (!heavy && !midString) {
    let s = raw.trim();
    try {
      if ((s.match(/"/g) || []).length % 2 === 1) s += '"';
      let openB = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
      let openA = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
      while (openA-- > 0) s += ']';
      while (openB-- > 0) s += '}';
      const parsed = JSON.parse(s);
      // Reject if a content-like field is suspiciously short after repair on non-heavy tools — still ok
      return { ok: true, args: parsed, repaired: true };
    } catch (_) {}
  }

  // Structured salvage for tree / single-file create — only COMPLETE content strings
  if (toolName === 'create_file_tree' || toolName === 'create_or_update_file' || toolName === 'write') {
    const salvaged = salvageCreateFileTreeArgs(raw);
    if (salvaged && salvaged.nodes?.length) {
      if ((toolName === 'create_or_update_file' || toolName === 'write') && salvaged.nodes[0]) {
        return {
          ok: true,
          args: {
            path: salvaged.path || salvaged.nodes[0].name,
            content: salvaged.nodes[0].content
          },
          salvaged: true
        };
      }
      if (toolName === 'create_file_tree') {
        return { ok: true, args: salvaged, salvaged: true };
      }
    }
  }

  // Explicit failure so agent loop can ask model to retry with smaller patches
  console.warn(TAG, 'refusing salvage for', toolName, 'len=', raw.length, 'midString=', midString);
  return {
    ok: false,
    args: {
      _parseError: true,
      _truncated: midString || heavy,
      _rawPreview: raw.slice(0, 400),
      _raw: raw
    }
  };
}
