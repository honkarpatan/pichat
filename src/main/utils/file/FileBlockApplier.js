/**
 * FileBlockApplier — extract path-tagged markdown code fences and write them
 * to the project via native FS (no second model tool-call round-trip).
 *
 * Supported header forms (line immediately above or on the fence):
 *   ### path/to/file.js
 *   ## file: path/to/file.js
 *   ```js path/to/file.js
 *   ```javascript:path/to/file.js
 *   ```html file="path/to/file.html"
 *   ```ts title="src/app.ts"
 *
 * Relative paths join against project root URI from getProjectFolder().
 */

import { getProjectFolder, createFile, createFolder } from './fileOperations.js';

const TAG = '[FileBlockApplier]';

// Fence: optional lang + optional path on same line
const FENCE_RE = /^```([a-zA-Z0-9_+-]*)[ \t]*(?:file\s*=\s*["']([^"']+)["']|title\s*=\s*["']([^"']+)["']|:([^\s`]+)|([^\s`]+))?[ \t]*$/gm;

// Heading just above a fence: ### path/file.ext  or  ## file: path
const HEADING_PATH_RE = /^(?:#{1,6}|\/\/|<!--)\s*(?:file\s*[:=]\s*)?([^\s*][^\n]*?\.[a-zA-Z0-9]{1,12})\s*(?:-->)?\s*$/;

const EXT_LANG = {
  js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
  html: 'html', htm: 'html', css: 'css', json: 'json', md: 'markdown',
  py: 'python', sh: 'bash', bash: 'bash', txt: 'text', svg: 'xml', xml: 'xml'
};

function looksLikePath(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!t || t.length > 240) return false;
  if (/^(javascript|typescript|python|html|css|json|bash|shell|text|xml|markdown|jsx|tsx|diff|plaintext)$/i.test(t)) return false;
  // must have extension or a slash
  return /\.[a-zA-Z0-9]{1,12}$/.test(t) || t.includes('/');
}

function normalizeRelPath(p) {
  return String(p || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

/**
 * Parse markdown text → [{ path, content, lang }]
 */
export function parseFileBlocks(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];
  const text = markdown.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const blocks = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)[ \t]*(.*)$/);
    if (!fenceMatch) {
      i++;
      continue;
    }

    const lang = (fenceMatch[1] || '').trim();
    let rest = (fenceMatch[2] || '').trim();
    let pathFromFence = null;

    // file="..." or title="..."
    const attr = rest.match(/(?:file|title|path)\s*=\s*["']([^"']+)["']/i);
    if (attr) pathFromFence = attr[1];
    else if (rest.startsWith(':')) pathFromFence = rest.slice(1).trim();
    else if (looksLikePath(rest)) pathFromFence = rest;

    // Heading on previous non-empty line
    let pathFromHeading = null;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const prev = lines[j].trim();
      if (!prev) continue;
      const hm = prev.match(HEADING_PATH_RE);
      if (hm && looksLikePath(hm[1])) {
        pathFromHeading = hm[1];
      }
      break;
    }

    const relPath = normalizeRelPath(pathFromFence || pathFromHeading || '');
    // Collect body until closing fence
    i++;
    const bodyLines = [];
    while (i < lines.length && !lines[i].startsWith('```')) {
      bodyLines.push(lines[i]);
      i++;
    }
    if (i < lines.length && lines[i].startsWith('```')) i++; // skip close

    if (!relPath || !looksLikePath(relPath)) continue;
    const content = bodyLines.join('\n');
    if (!content.trim()) continue;
    // Reject junk: model often nests "### path" / empty fences inside the block with no real code
    const stripped = content.replace(/^\s*#{1,6}\s+\S+\s*$/gm, '').replace(/```[a-zA-Z0-9_+-]*/g, '').trim();
    if (stripped.length < 40) continue;
    if (/^(###?\s+\S+\s*)+$/m.test(content.trim()) && content.length < 120) continue;

    // OLD/NEW replace bodies must not be saved as the file itself
    if (/@@@OLD|<<<<<<<\s*OLD/i.test(content) && /@@@NEW|=======/i.test(content)) {
      blocks.push({
        path: relPath,
        content,
        lang: lang || '',
        kind: 'replace_marker' // consumer must convert — applyFileBlocks skips raw write
      });
      continue;
    }

    blocks.push({
      path: relPath,
      content,
      lang: lang || EXT_LANG[relPath.split('.').pop()?.toLowerCase()] || ''
    });
  }

  // Dedupe by path (last wins)
  const map = new Map();
  for (const b of blocks) map.set(b.path, b);
  return Array.from(map.values());
}

/**
 * Resolve relative path against project root content:// URI
 */
export async function resolveProjectPath(relPath) {
  const project = await getProjectFolder();
  if (!project?.uri) {
    return { error: 'No project folder open. Open a folder in the sidebar first.' };
  }
  const rel = normalizeRelPath(relPath);
  if (!rel) return { error: 'Empty path' };

  // If already a full content URI, use as-is
  if (rel.startsWith('content://') || rel.startsWith('file://')) {
    return { fullPath: rel, project };
  }

  const root = project.uri.replace(/\/$/, '');
  // Avoid double-joining project name if relative already starts with it
  const name = project.name || '';
  let joined = rel;
  if (name && (rel === name || rel.startsWith(name + '/'))) {
    joined = rel;
    // Prefer root URI + rest after name when root already points at project
    const rest = rel === name ? '' : rel.slice(name.length + 1);
    const fullPath = rest ? `${root}/${rest}` : root;
    return { fullPath, project, rel: rest || '.' };
  }

  const fullPath = `${root}/${joined}`;
  return { fullPath, project, rel: joined };
}

async function ensureParentFolders(fullPath) {
  // fullPath like content://...::/Ay/snake_game/css/style.css
  const parts = fullPath.split('/');
  // Walk from project depth — create intermediate folders best-effort
  // Only last segment is the file name
  if (parts.length < 2) return;
  const fileName = parts[parts.length - 1];
  // Parent path
  const parentUrl = fullPath.slice(0, fullPath.length - fileName.length - 1);
  if (!parentUrl) return;

  // Try create leaf parent name under its parent
  try {
    const segs = parentUrl.split('/');
    // Heuristic: create nested dirs from project root segment if missing
    // createFolder is best-effort per folder name
    const rootIdx = parentUrl.indexOf('::');
    if (rootIdx === -1) return;
    const treeBase = parentUrl.slice(0, rootIdx + 2); // include ::
    const after = parentUrl.slice(rootIdx + 2).replace(/^\/+/, '');
    const folders = after.split('/').filter(Boolean);
    let current = parentUrl.includes('::')
      ? parentUrl.slice(0, parentUrl.indexOf('::') + 2) + (parentUrl.split('::')[1]?.match(/^\/*[^/]+/)?.[0] || '')
      : parentUrl;

    // Simpler: for each progressive path under root
    const project = await getProjectFolder();
    if (!project?.uri) return;
    let cursor = project.uri.replace(/\/$/, '');
    // folders relative to project
    const rel = normalizeRelPath(fullPath.replace(project.uri, '').replace(/^\/+/, ''));
    const relParts = rel.split('/').filter(Boolean);
    // all but last (file)
    for (let i = 0; i < relParts.length - 1; i++) {
      const name = relParts[i];
      try {
        await createFolder(cursor, name, { overwrite: true });
      } catch (e) { /* exists ok */ }
      cursor = `${cursor}/${name}`;
    }
  } catch (e) {
    console.warn(TAG, 'ensureParentFolders', e);
  }
}

/**
 * Apply parsed blocks to disk. Returns results array for UI timeline.
 */
export async function applyFileBlocks(markdown, { onProgress } = {}) {
  const blocks = parseFileBlocks(markdown);
  if (!blocks.length) return { applied: [], skipped: true, reason: 'no_path_tagged_blocks' };

  const applied = [];
  for (const block of blocks) {
    if (block.kind === 'replace_marker') {
      // Handled by PendingWriteGate / search_replace — never write markers as file body
      applied.push({ path: block.path, success: false, error: 'replace_block_needs_apply_gate', skipped: true });
      continue;
    }
    const resolved = await resolveProjectPath(block.path);
    if (resolved.error) {
      applied.push({ path: block.path, success: false, error: resolved.error });
      if (onProgress) onProgress({ path: block.path, success: false, error: resolved.error });
      continue;
    }

    try {
      await ensureParentFolders(resolved.fullPath);
      const split = resolved.fullPath.lastIndexOf('/');
      const parentUrl = resolved.fullPath.slice(0, split);
      const name = resolved.fullPath.slice(split + 1);
      const result = await createFile(parentUrl, name, block.content, { overwrite: true });
      const ok = !!(result && result.success);
      const row = {
        path: block.path,
        fullPath: resolved.fullPath,
        url: result?.url || resolved.fullPath,
        success: ok,
        error: ok ? undefined : (result?.message || result?.error || 'write failed'),
        lang: block.lang
      };
      applied.push(row);
      if (onProgress) onProgress(row);
      console.log(TAG, ok ? 'wrote' : 'fail', block.path, row.error || '');
    } catch (e) {
      const row = { path: block.path, success: false, error: e.message || String(e) };
      applied.push(row);
      if (onProgress) onProgress(row);
    }
  }

  return {
    applied,
    skipped: false,
    successCount: applied.filter(a => a.success).length,
    failCount: applied.filter(a => !a.success).length
  };
}

/**
 * Parse code fences that have NO path (loose fix snippets).
 * Used when model pastes a small fixed fragment without ### path.
 */
export function parseLooseCodeBlocks(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];
  const text = markdown.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^```([a-zA-Z0-9_+-]*)[ \t]*(.*)$/);
    if (!fenceMatch) { i++; continue; }
    const lang = (fenceMatch[1] || '').trim();
    const rest = (fenceMatch[2] || '').trim();
    // Skip if this fence already has a path (handled by parseFileBlocks)
    const attr = rest.match(/(?:file|title|path)\s*=\s*["']([^"']+)["']/i);
    const maybePath = attr?.[1] || (rest.startsWith(':') ? rest.slice(1) : rest);
    const hasPath = maybePath && looksLikePath(maybePath);
    let pathFromHeading = false;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const prev = lines[j].trim();
      if (!prev) continue;
      const hm = prev.match(HEADING_PATH_RE);
      if (hm && looksLikePath(hm[1])) pathFromHeading = true;
      break;
    }
    i++;
    const bodyLines = [];
    while (i < lines.length && !lines[i].startsWith('```')) {
      bodyLines.push(lines[i]);
      i++;
    }
    if (i < lines.length && lines[i].startsWith('```')) i++;
    if (hasPath || pathFromHeading) continue;
    const content = bodyLines.join('\n');
    if (!content.trim()) continue;
    blocks.push({ content, lang, lines: bodyLines.length });
  }
  return blocks;
}

/**
 * Apply a single loose code block to the currently active editor file
 * (full overwrite). For true search/replace diffs, prefer search_replace_edit tool.
 * Returns null if no active file or block too ambiguous.
 */
export async function applyLooseBlockToActiveFile(markdown) {
  const loose = parseLooseCodeBlocks(markdown);
  if (loose.length !== 1) {
    return { skipped: true, reason: loose.length === 0 ? 'no_loose_blocks' : 'multiple_loose_blocks' };
  }
  const block = loose[0];
  // Tiny fragments (< 3 lines) without path are unsafe to full-overwrite
  if (block.lines < 3 && block.content.length < 80) {
    return {
      skipped: true,
      reason: 'snippet_too_small',
      hint: 'Ask model for path-tagged block or search_replace_edit with search/replace pairs.'
    };
  }

  const active = typeof window !== 'undefined' ? window.editorManager?.activeFile : null;
  if (!active?.uri || String(active.uri).includes('com.foxdebug.acode')) {
    return { skipped: true, reason: 'no_active_file' };
  }

  try {
    const uri = active.uri;
    const lastSlash = uri.lastIndexOf('/');
    const parentUrl = uri.slice(0, lastSlash);
    const name = uri.slice(lastSlash + 1) || active.name;
    const result = await createFile(parentUrl, name, block.content, { overwrite: true });
    return {
      skipped: false,
      applied: [{
        path: active.name || name,
        fullPath: uri,
        url: result?.url || uri,
        success: !!(result && result.success),
        error: result?.success ? undefined : (result?.message || 'write failed'),
        mode: 'active_file_overwrite'
      }],
      successCount: result?.success ? 1 : 0,
      failCount: result?.success ? 0 : 1
    };
  } catch (e) {
    return { skipped: false, successCount: 0, failCount: 1, applied: [{ success: false, error: e.message }] };
  }
}
