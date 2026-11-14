/**
 * Export / import `.aicodex/` as a single JSON pack (portable project agent state).
 */
import {
  getProjectFolder, listDir, readFile, createFolder, createFile,
  normalizeSafUrl, joinSafPath
} from '../utils/file/fileOperations.js';

const TAG = '[AicodePack]';
const PACK_NAME = 'aicodex-pack.json';
const MAX_FILE_CHARS = 200_000;

async function tryReadRel(projectUri, rel) {
  try {
    const url = joinSafPath(projectUri, rel);
    const r = await readFile(normalizeSafUrl(url), 'utf-8');
    if (r?.success && typeof r.content === 'string') return r.content;
  } catch (_) {}
  return null;
}

async function walkSkills(projectUri, baseRel, out, depth = 0) {
  if (depth > 4) return;
  try {
    const listed = await listDir(normalizeSafUrl(joinSafPath(projectUri, baseRel)));
    if (!listed?.success || !Array.isArray(listed.entries)) return;
    for (const e of listed.entries) {
      const name = e.name || e;
      if (!name || name === '.' || name === '..') continue;
      const rel = baseRel + '/' + name;
      if (e.isDirectory) {
        await walkSkills(projectUri, rel, out, depth + 1);
      } else if (/skill\.md$/i.test(name)) {
        const body = await tryReadRel(projectUri, rel);
        if (body != null) out[rel.replace(/^\.aicodex\//, '')] = body.slice(0, MAX_FILE_CHARS);
      }
    }
  } catch (_) {}
}

/**
 * Build pack object from current project .aicodex
 */
export async function buildAicodePack() {
  const project = await getProjectFolder();
  if (!project?.uri) return { success: false, error: 'No project folder' };

  const files = {};
  const memory = await tryReadRel(project.uri, '.aicodex/project_memory.md');
  if (memory != null) files['project_memory.md'] = memory.slice(0, MAX_FILE_CHARS);

  const repomap = await tryReadRel(project.uri, '.aicodex/repomap.json');
  if (repomap != null) files['repomap.json'] = repomap.slice(0, MAX_FILE_CHARS);

  await walkSkills(project.uri, '.aicodex/skills', files);

  const pack = {
    version: 1,
    kind: 'aicodex-pack',
    project: project.name || '',
    exportedAt: new Date().toISOString(),
    files
  };

  // Also write to disk for easy copy
  try {
    await createFolder(project.uri, '.aicodex', { overwrite: true });
    await createFile(
      project.uri,
      '.aicodex/' + PACK_NAME,
      JSON.stringify(pack, null, 2),
      { overwrite: true }
    );
  } catch (e) {
    console.warn(TAG, 'write pack file', e?.message || e);
  }

  console.log(TAG, 'export keys=', Object.keys(files));
  return { success: true, pack, path: '.aicodex/' + PACK_NAME, fileCount: Object.keys(files).length };
}

/**
 * Import pack into .aicodex/
 * @param {object|string} packOrJson
 */
export async function importAicodePack(packOrJson) {
  const project = await getProjectFolder();
  if (!project?.uri) return { success: false, error: 'No project folder' };

  let pack = packOrJson;
  if (typeof pack === 'string') {
    try {
      pack = JSON.parse(pack);
    } catch (e) {
      return { success: false, error: 'Invalid JSON: ' + (e.message || e) };
    }
  }
  if (!pack || typeof pack !== 'object' || !pack.files || typeof pack.files !== 'object') {
    // Try reading default path
    const raw = await tryReadRel(project.uri, '.aicodex/' + PACK_NAME);
    if (!raw) return { success: false, error: 'No pack object and no .aicodex/' + PACK_NAME };
    try {
      pack = JSON.parse(raw);
    } catch (e) {
      return { success: false, error: 'Invalid pack file JSON' };
    }
  }

  await createFolder(project.uri, '.aicodex', { overwrite: true });
  const written = [];
  const errors = [];

  for (const [rel, content] of Object.entries(pack.files || {})) {
    if (typeof content !== 'string') continue;
    const safe = String(rel).replace(/^\/+/, '').replace(/\.\./g, '');
    if (!safe || safe.includes('..')) continue;
    try {
      const fullRel = '.aicodex/' + safe;
      const res = await createFile(project.uri, fullRel, content, { overwrite: true });
      if (res?.success) written.push(fullRel);
      else errors.push(safe + ': ' + (res?.message || 'fail'));
    } catch (e) {
      errors.push(safe + ': ' + (e?.message || e));
    }
  }

  console.log(TAG, 'import written=', written.length, 'errors=', errors.length);
  return {
    success: errors.length === 0,
    written,
    errors,
    message: `Imported ${written.length} file(s)` + (errors.length ? `, ${errors.length} error(s)` : '')
  };
}

export const AicodePack = { buildAicodePack, importAicodePack, PACK_NAME };
