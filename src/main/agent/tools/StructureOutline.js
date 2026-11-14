/**
 * M7 — Structure outline (tree-sitter-class quality without WASM dependency).
 * Language-aware landmarks with start/end line ranges for selector/function-level edits.
 *
 * If a global tree-sitter / web-tree-sitter is ever injected, parseWithTreeSitter()
 * can be swapped in; until then regex + brace/tag matching is the portable path.
 */

/**
 * @typedef {{ kind: string, name: string, line: number, endLine?: number, detail?: string }} OutlineSymbol
 */

export function detectLang(path = '', contentHead = '') {
  const p = String(path).toLowerCase();
  if (/\.(html?|xhtml|vue|svelte)$/.test(p)) return 'html';
  if (/\.(css|scss|less)$/.test(p)) return 'css';
  if (/\.(tsx|jsx)$/.test(p)) return 'jsx';
  if (/\.(ts|mts|cts)$/.test(p)) return 'ts';
  if (/\.(js|mjs|cjs)$/.test(p)) return 'js';
  if (/\.py$/.test(p)) return 'py';
  if (/\.(java|kt|kts)$/.test(p)) return 'jvm';
  if (/\.(go)$/.test(p)) return 'go';
  if (/\.(rs)$/.test(p)) return 'rust';
  if (/\.(json)$/.test(p)) return 'json';
  // content sniff
  const h = contentHead.slice(0, 400);
  if (/<!DOCTYPE\s+html|<html[\s>]/i.test(h)) return 'html';
  if (/^\s*(import|export|function|const|class)\b/m.test(h)) return 'js';
  return 'text';
}

function findMatchingBrace(lines, startIdx, openCh = '{', closeCh = '}') {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    const L = lines[i];
    // skip pure comment lines
    if (/^\s*\/\//.test(L) || /^\s*\*/.test(L)) {
      if (!started) continue;
    }
    for (let j = 0; j < L.length; j++) {
      const c = L[j];
      // crude string skip
      if (c === '"' || c === "'" || c === '`') {
        const q = c;
        j++;
        while (j < L.length && L[j] !== q) {
          if (L[j] === '\\') j++;
          j++;
        }
        continue;
      }
      if (c === openCh) {
        depth++;
        started = true;
      } else if (c === closeCh) {
        depth--;
        if (started && depth === 0) return i;
      }
    }
  }
  return Math.min(lines.length - 1, startIdx + 80);
}

function findMatchingTag(lines, startIdx, tagName) {
  const openRe = new RegExp(`<${tagName}\\b`, 'i');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'i');
  const selfClose = /^\s*<[^>]+\/\s*>/;
  if (selfClose.test(lines[startIdx]) || /\/>\s*$/.test(lines[startIdx])) {
    return startIdx;
  }
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const L = lines[i];
    if (openRe.test(L) && !selfClose.test(L)) depth++;
    if (closeRe.test(L)) {
      depth--;
      if (depth <= 0) return i;
    }
  }
  return Math.min(lines.length - 1, startIdx + 40);
}

/**
 * @param {string[]} lines
 * @param {string} lang
 * @param {{ max?: number }} opts
 * @returns {OutlineSymbol[]}
 */
export function buildStructureOutline(lines, lang, opts = {}) {
  const max = opts.max || 80;
  /** @type {OutlineSymbol[]} */
  const out = [];
  const push = (sym) => {
    if (out.length >= max) return;
    out.push(sym);
  };

  if (lang === 'html') outlineHtml(lines, push);
  else if (lang === 'css') outlineCss(lines, push);
  else if (lang === 'js' || lang === 'ts' || lang === 'jsx') outlineJs(lines, push, lang);
  else if (lang === 'py') outlinePy(lines, push);
  else if (lang === 'jvm') outlineJvm(lines, push);
  else if (lang === 'go') outlineGo(lines, push);
  else {
    // generic: functions + classes + headings
    outlineJs(lines, push, 'js');
    outlineHtml(lines, push);
  }

  // dedupe by kind:name:line
  const seen = new Set();
  const uniq = [];
  for (const s of out) {
    const k = `${s.kind}:${s.name}:${s.line}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(s);
  }
  return uniq.slice(0, max);
}

function outlineHtml(lines, push) {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const n = i + 1;
    let m;
    if ((m = /<(style)\b/i.exec(L))) {
      const end = findMatchingTag(lines, i, 'style');
      push({ kind: 'block', name: '<style>', line: n, endLine: end + 1 });
    }
    if ((m = /<(script)\b/i.exec(L))) {
      const end = findMatchingTag(lines, i, 'script');
      push({ kind: 'block', name: '<script>', line: n, endLine: end + 1 });
    }
    if ((m = /<(main|header|footer|nav|section|article|aside|form|table)\b/i.exec(L))) {
      const tag = m[1].toLowerCase();
      const end = findMatchingTag(lines, i, tag);
      push({ kind: 'tag', name: `<${tag}>`, line: n, endLine: end + 1 });
    }
    if ((m = /\bid=["']([^"']+)["']/i.exec(L))) {
      const tagM = /<([a-zA-Z0-9-]+)/.exec(L);
      const tag = tagM ? tagM[1] : 'el';
      const end = tagM ? findMatchingTag(lines, i, tagM[1]) : i;
      push({ kind: 'id', name: `#${m[1]}`, line: n, endLine: end + 1, detail: tag });
    }
    if ((m = /\bclass=["']([^"']+)["']/i.exec(L))) {
      const classes = m[1].split(/\s+/).filter(Boolean).slice(0, 3);
      const tagM = /<([a-zA-Z0-9-]+)/.exec(L);
      for (const c of classes) {
        push({
          kind: 'class',
          name: `.${c}`,
          line: n,
          endLine: tagM ? findMatchingTag(lines, i, tagM[1]) + 1 : n,
          detail: tagM ? tagM[1] : undefined
        });
      }
    }
    if ((m = /<h([1-6])\b[^>]*>([^<]{0,40})/i.exec(L))) {
      push({ kind: 'heading', name: `h${m[1]}:${m[2].trim() || '…'}`, line: n, endLine: n });
    }
  }
}

function outlineCss(lines, push) {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/^\s*\/\*/.test(L) || /^\s*\*/.test(L) || /^\s*\/\//.test(L)) continue;
    // selector {  or multi-line selector ending with {
    const m = /^\s*([^{}/@][^{}]{0,80})\s*\{/.exec(L);
    if (m) {
      const sel = m[1].trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!sel || sel.startsWith('@')) continue;
      const end = findMatchingBrace(lines, i);
      push({ kind: 'selector', name: sel, line: i + 1, endLine: end + 1 });
    }
    if (/^\s*@media\b/.test(L) || /^\s*@keyframes\b/.test(L) || /^\s*@supports\b/.test(L)) {
      const name = L.trim().replace(/\s*\{.*$/, '').slice(0, 50);
      const end = findMatchingBrace(lines, i);
      push({ kind: 'at-rule', name, line: i + 1, endLine: end + 1 });
    }
  }
}

function outlineJs(lines, push, lang) {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const n = i + 1;
    let m;
    // function decl
    if ((m = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(L))) {
      const end = findMatchingBrace(lines, i);
      push({ kind: 'function', name: m[1], line: n, endLine: end + 1 });
      continue;
    }
    // class
    if ((m = /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(L))) {
      const end = findMatchingBrace(lines, i);
      push({ kind: 'class', name: m[1], line: n, endLine: end + 1 });
      continue;
    }
    // const foo = function / arrow
    if ((m = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.exec(L))) {
      const end = L.includes('{') ? findMatchingBrace(lines, i) : i;
      push({ kind: 'function', name: m[1], line: n, endLine: end + 1 });
      continue;
    }
    // method inside class (indent + name() {)
    if ((m = /^\s+(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(L))) {
      if (!['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) {
        const end = findMatchingBrace(lines, i);
        push({ kind: 'method', name: m[1], line: n, endLine: end + 1 });
      }
    }
    // interface / type (TS)
    if (lang === 'ts' || lang === 'jsx') {
      if ((m = /^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/.exec(L))) {
        const end = L.includes('{') ? findMatchingBrace(lines, i) : i;
        push({ kind: 'type', name: m[1], line: n, endLine: end + 1 });
      }
    }
  }
}

function outlinePy(lines, push) {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let m;
    if ((m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/.exec(L))) {
      const indent = m[1].length;
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue;
        const ind = lines[j].match(/^\s*/)[0].length;
        if (ind <= indent && !lines[j].trim().startsWith('#')) {
          // python: next same/less indent ends block
          if (!/^\s*(elif|else|except|finally)\b/.test(lines[j])) {
            end = j - 1;
            break;
          }
        }
        end = j;
      }
      push({ kind: 'function', name: m[2], line: i + 1, endLine: end + 1 });
    }
    if ((m = /^(\s*)class\s+([A-Za-z_][\w]*)/.exec(L))) {
      const indent = m[1].length;
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue;
        const ind = lines[j].match(/^\s*/)[0].length;
        if (ind <= indent) {
          end = j - 1;
          break;
        }
        end = j;
      }
      push({ kind: 'class', name: m[2], line: i + 1, endLine: end + 1 });
    }
  }
}

function outlineJvm(lines, push) {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let m;
    if ((m = /^\s*(?:public|private|protected|internal|open|data|sealed)?\s*class\s+([A-Za-z_][\w]*)/.exec(L))) {
      const end = findMatchingBrace(lines, i);
      push({ kind: 'class', name: m[1], line: i + 1, endLine: end + 1 });
    }
    if ((m = /^\s*(?:public|private|protected|override|suspend|fun|fun)\s+(?:fun\s+)?([A-Za-z_][\w]*)\s*\(/.exec(L))
      || (m = /^\s*(?:public|private|protected|static)?\s*(?:final\s+)?(?:synchronized\s+)?(?:[\w.<>,\[\]\s]+)\s+([A-Za-z_][\w]*)\s*\(/.exec(L))) {
      if (!['if', 'for', 'while', 'switch', 'catch'].includes(m[1])) {
        const end = findMatchingBrace(lines, i);
        push({ kind: 'method', name: m[1], line: i + 1, endLine: end + 1 });
      }
    }
  }
}

function outlineGo(lines, push) {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let m;
    if ((m = /^func\s+(?:\([^)]+\)\s*)?([A-Za-z_][\w]*)\s*\(/.exec(L))) {
      const end = findMatchingBrace(lines, i);
      push({ kind: 'function', name: m[1], line: i + 1, endLine: end + 1 });
    }
    if ((m = /^type\s+([A-Za-z_][\w]*)\s+struct\b/.exec(L))) {
      const end = findMatchingBrace(lines, i);
      push({ kind: 'struct', name: m[1], line: i + 1, endLine: end + 1 });
    }
  }
}

/**
 * Format symbols for model-facing text.
 */
export function formatOutlineText(symbols, { path = '', totalLines = 0 } = {}) {
  if (!symbols.length) return '(no landmarks detected)';
  return symbols.map((s) => {
    const range = s.endLine && s.endLine !== s.line
      ? `L${s.line}–${s.endLine}`
      : `L${s.line}`;
    const detail = s.detail ? ` (${s.detail})` : '';
    return `${range.padEnd(12)} ${String(s.kind).padEnd(10)} ${s.name}${detail}`;
  }).join('\n');
}

/**
 * Optional future: if window.TreeSitter / Parser exists, use it.
 * @returns {Promise<OutlineSymbol[]|null>}
 */
export async function tryTreeSitterOutline(_path, _content) {
  try {
    const TS = typeof globalThis !== 'undefined' && (globalThis.TreeSitter || globalThis.Parser);
    if (!TS) return null;
    // No language WASM bundled in plugin yet — return null to use regex path
    return null;
  } catch (_) {
    return null;
  }
}
