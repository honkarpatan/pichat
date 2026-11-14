/**
 * Shallow project file index for @file mentions autocomplete.
 */
import { getProjectFolder, listDir, normalizeSafUrl, joinSafPath } from '../utils/file/fileOperations.js';

const TAG = '[FileIndex]';
const MAX_FILES = 400;
const MAX_DEPTH = 4;
const SKIP = new Set([
  'node_modules', '.git', '.gradle', 'build', 'dist', '.cache',
  '__pycache__', '.idea', '.vscode', 'vendor'
]);

let _cache = { key: '', at: 0, files: [] };
const CACHE_MS = 30_000;

async function walk(uri, prefix, depth, out) {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
  let entries = [];
  try {
    const listed = await listDir(normalizeSafUrl(uri));
    if (listed?.success && Array.isArray(listed.entries)) entries = listed.entries;
  } catch (_) {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const name = e.name || e;
    if (!name || name === '.' || name === '..') continue;
    if (SKIP.has(name)) continue;
    // Skip Acode unique-name clones: ".aicodex (1)", ".aicodex (2)"
    if (/^\.aicodex \(\d+\)$/i.test(name)) continue;
    const rel = prefix ? prefix + '/' + name : name;
    if (e.isDirectory) {
      const child = joinSafPath(uri, name);
      await walk(child, rel, depth + 1, out);
    } else {
      out.push(rel.replace(/\\/g, '/'));
    }
  }
}

/**
 * @returns {Promise<string[]>} relative paths
 */
export async function getProjectFileIndex(force = false) {
  const project = await getProjectFolder();
  if (!project?.uri) return [];
  const key = normalizeSafUrl(project.uri);
  const now = Date.now();
  if (!force && _cache.key === key && now - _cache.at < CACHE_MS && _cache.files.length) {
    return _cache.files;
  }
  const files = [];
  await walk(project.uri, '', 0, files);
  files.sort((a, b) => a.localeCompare(b));
  _cache = { key, at: now, files };
  console.log(TAG, 'indexed', files.length, 'files');
  return files;
}

export function filterFiles(files, query, limit = 12) {
  const q = String(query || '').toLowerCase().replace(/^@/, '');
  if (!q) return files.slice(0, limit);
  const scored = [];
  for (const f of files) {
    const low = f.toLowerCase();
    const base = low.split('/').pop() || low;
    let score = 0;
    if (base.startsWith(q)) score = 100;
    else if (low.includes('/' + q)) score = 80;
    else if (base.includes(q)) score = 60;
    else if (low.includes(q)) score = 40;
    else continue;
    // prefer shorter paths
    score -= Math.min(20, f.length / 10);
    scored.push({ f, score });
  }
  scored.sort((a, b) => b.score - a.score || a.f.length - b.f.length);
  return scored.slice(0, limit).map(x => x.f);
}

/** @returns {string[]} paths mentioned as @path in text */
export function extractAtMentions(text) {
  const s = String(text || '');
  const found = [];
  // @path/to/file.ext or @file.js — stop at whitespace
  const re = /@([A-Za-z0-9_./-]+\.[A-Za-z0-9]+|[A-Za-z0-9_./-]+\/[A-Za-z0-9_./-]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const p = m[1].replace(/^\.\//, '');
    if (p && !found.includes(p)) found.push(p);
  }
  return found;
}

export function invalidateFileIndex() {
  _cache = { key: '', at: 0, files: [] };
}
