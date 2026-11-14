/**
 * Project repomap cache → .aicodex/repomap.json
 * Lightweight file tree + extension stats for agent context.
 */
import {
  getProjectFolder, listDir, readFile, writeFile, createFolder, createFile,
  normalizeSafUrl, joinSafPath
} from '../utils/file/fileOperations.js';
import { getProjectFileIndex, invalidateFileIndex } from './ProjectFileIndex.js';

const TAG = '[RepoMap]';
const REL_PATH = '.aicodex/repomap.json';
const MAX_FILES_IN_MAP = 300;
const MAX_CONTEXT_CHARS = 3500;
const CACHE_TTL_MS = 5 * 60 * 1000; // rebuild if older than 5 min unless force

function extOf(path) {
  const base = String(path).split('/').pop() || '';
  const i = base.lastIndexOf('.');
  if (i <= 0) return '(none)';
  return base.slice(i).toLowerCase();
}

function buildTreeLines(files) {
  // Full relative paths only — no leading spaces / indent prefixes
  const dirs = new Set();
  const lines = [];
  const sorted = [...files].map(f => String(f).replace(/^\s+/, '').replace(/\\/g, '/')).filter(Boolean);
  sorted.sort((a, b) => a.localeCompare(b));
  for (const f of sorted) {
    const parts = f.split('/').filter(Boolean);
    // Emit parent dir markers without trailing-only indent
    if (parts.length > 1) {
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? acc + '/' + parts[i] : parts[i];
        const d = acc + '/';
        if (!dirs.has(d)) {
          dirs.add(d);
          lines.push(d);
        }
      }
    }
    lines.push(f);
  }
  return lines;
}

/**
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ map: object, fromCache: boolean, path: string }>}
 */
export async function buildRepoMap(opts = {}) {
  const force = !!opts.force;
  const project = await getProjectFolder();
  if (!project?.uri) {
    return { map: null, fromCache: false, path: REL_PATH, error: 'No project folder' };
  }

  // Try cache
  if (!force) {
    try {
      const url = joinSafPath(project.uri, REL_PATH);
      const r = await readFile(normalizeSafUrl(url), 'utf-8');
      if (r?.success && r.content) {
        const parsed = JSON.parse(r.content);
        const age = Date.now() - (parsed.generatedAt || 0);
        if (age >= 0 && age < CACHE_TTL_MS && Array.isArray(parsed.files)) {
          // Invalidate if cached map is for a different project name (sibling Test4 vs Test5)
          const cachedProj = String(parsed.project || '');
          const curProj = String(project.name || '');
          if (cachedProj && curProj && cachedProj !== curProj) {
            console.log(TAG, 'cache miss — project name mismatch', cachedProj, '≠', curProj);
          } else {
            console.log(TAG, 'cache hit age=', Math.round(age / 1000) + 's', 'project=', curProj || '?');
            return { map: parsed, fromCache: true, path: REL_PATH };
          }
        }
      }
    } catch (_) {}
  }

  if (force) {
    try { invalidateFileIndex(); } catch (_) {}
  }

  const files = await getProjectFileIndex(force);
  const limited = files.slice(0, MAX_FILES_IN_MAP);
  const byExt = {};
  for (const f of limited) {
    const e = extOf(f);
    byExt[e] = (byExt[e] || 0) + 1;
  }

  const map = {
    version: 1,
    project: project.name || '',
    generatedAt: Date.now(),
    fileCount: files.length,
    truncated: files.length > MAX_FILES_IN_MAP,
    byExtension: byExt,
    files: limited,
    tree: buildTreeLines(limited)
  };

  // Persist under .aicodex/ via createFile (creates parents safely, overwrite)
  try {
    const folderRes = await createFolder(project.uri, '.aicodex', { overwrite: true });
    console.log(TAG, 'ensure .aicodex', folderRes?.message || folderRes?.success);
    const body = JSON.stringify(map, null, 2);
    // Prefer createFile with relative path under project (handles nested + overwrite)
    const w = await createFile(project.uri, REL_PATH, body, { overwrite: true });
    if (w?.success) {
      console.log(TAG, 'wrote', REL_PATH, 'files=', map.fileCount, 'url=', (w.url || '').toString().slice(-40));
    } else {
      // Fallback: writeFile on joined path
      const url = joinSafPath(
        folderRes?.url ? normalizeSafUrl(folderRes.url) : project.uri,
        'repomap.json'
      );
      const w2 = await writeFile(normalizeSafUrl(url), body);
      if (w2?.success) {
        console.log(TAG, 'wrote via writeFile', REL_PATH, 'files=', map.fileCount);
      } else {
        console.warn(TAG, 'write failed', w?.message || w2?.message || 'unknown');
      }
    }
  } catch (e) {
    console.warn(TAG, 'write failed', e?.message || String(e));
  }

  return { map, fromCache: false, path: REL_PATH };
}

/**
 * Compact text for agent system/user injection.
 */
export function formatRepoMapContext(map) {
  if (!map || !Array.isArray(map.files)) return '';
  const extLines = Object.entries(map.byExtension || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([e, n]) => `${e}: ${n}`)
    .join(', ');

  let body =
    `[Project repomap — ${map.fileCount} files` +
    (map.truncated ? ' (truncated)' : '') +
    `]\n` +
    (extLines ? `Extensions: ${extLines}\n` : '') +
    `Tree:\n` +
    (map.tree || []).slice(0, 80).join('\n');

  if (body.length > MAX_CONTEXT_CHARS) {
    body = body.slice(0, MAX_CONTEXT_CHARS) + '\n…[truncated]';
  }
  return body;
}

/**
 * Load (cached or rebuild) and return context string.
 */
export async function loadRepoMapContext(opts = {}) {
  const { map, fromCache, error } = await buildRepoMap(opts);
  if (error || !map) return '';
  const text = formatRepoMapContext(map);
  return text ? text + (fromCache ? '\n(from cache)' : '') : '';
}

export const RepoMap = { buildRepoMap, formatRepoMapContext, loadRepoMapContext };
