/**
 * Append-only audit log under .aicodex/audit.jsonl
 */
import {
  getProjectFolder, createFolder, readFile, writeFile, createFile,
  normalizeSafUrl, joinSafPath
} from '../../utils/file/fileOperations.js';

const TAG = '[Audit]';
const REL = '.aicodex/audit.jsonl';
const MAX_LINES = 400;

export async function appendMutationAudit(entry) {
  try {
    const project = await getProjectFolder();
    if (!project?.uri) return;

    const row = {
      ts: new Date().toISOString(),
      tool: entry.tool || entry.name || '',
      path: entry.path || '',
      ok: entry.ok !== false,
      dryRun: !!entry.dryRun,
      chat: entry.chatIndex != null ? String(entry.chatIndex) : undefined
    };
    const line = JSON.stringify(row);

    await createFolder(project.uri, '.aicodex', { overwrite: true });

    let prev = '';
    try {
      const r = await readFile(normalizeSafUrl(joinSafPath(project.uri, REL)), 'utf-8');
      if (r?.success && typeof r.content === 'string') prev = r.content;
    } catch (_) {}

    let lines = prev ? prev.split('\n').filter(Boolean) : [];
    lines.push(line);
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);

    const body = lines.join('\n') + '\n';
    const w = await createFile(project.uri, REL, body, { overwrite: true });
    if (!w?.success) {
      await writeFile(normalizeSafUrl(joinSafPath(project.uri, REL)), body);
    }
  } catch (e) {
    console.warn(TAG, e?.message || e);
  }
}

export const MutationAudit = { appendMutationAudit };
