/**
 * User-defined agents from .aicodex/agents/<name>/AGENT.md
 *
 * Frontmatter:
 *   name: security-review
 *   description: Read-only security pass
 *   model: qwen/qwen3.7-flash   (optional)
 *   readonly: true
 *   maxSteps: 15
 *   tools: read, list_directory, glob, grep, finish_task
 * Body: system prompt for the subagent
 */
import {
  getProjectFolder, listDir, readFile, normalizeSafUrl, joinSafPath
} from '../../utils/file/fileOperations.js';

const TAG = '[CustomAgents]';
const ROOT = '.aicodex/agents';

function parseFrontmatter(raw) {
  const text = String(raw || '');
  if (!text.startsWith('---')) {
    return { meta: {}, body: text.trim() };
  }
  const end = text.indexOf('---', 3);
  if (end < 0) return { meta: {}, body: text.trim() };
  const fm = text.slice(3, end).trim();
  const body = text.slice(end + 3).trim();
  const meta = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body };
}

function parseTools(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw)
    .split(/[,|\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function parseBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

async function readAgentFile(projectUri, rel) {
  try {
    const r = await readFile(normalizeSafUrl(joinSafPath(projectUri, rel)), 'utf-8');
    if (r?.success && typeof r.content === 'string') return r.content;
  } catch (_) {}
  return null;
}

/**
 * @returns {Promise<Array<object>>}
 */
export async function discoverCustomAgents() {
  const project = await getProjectFolder();
  if (!project?.uri) return [];

  const found = [];
  try {
    const listed = await listDir(normalizeSafUrl(joinSafPath(project.uri, ROOT)));
    if (!listed?.success || !Array.isArray(listed.entries)) return [];

    for (const e of listed.entries) {
      const name = e.name || e;
      if (!name || name.startsWith('.')) continue;

      let content = null;
      let rel = null;

      if (e.isDirectory) {
        for (const fname of ['AGENT.md', 'agent.md', 'AGENTS.md']) {
          rel = `${ROOT}/${name}/${fname}`;
          content = await readAgentFile(project.uri, rel);
          if (content) break;
        }
      } else if (/\.md$/i.test(name)) {
        rel = `${ROOT}/${name}`;
        content = await readAgentFile(project.uri, rel);
      }
      if (!content) continue;

      const { meta, body } = parseFrontmatter(content);
      const id = String(meta.name || name.replace(/\.md$/i, ''))
        .replace(/^\//, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-');

      const tools = parseTools(meta.tools);
      const readonly = parseBool(meta.readonly, tools ? false : true);
      const maxSteps = meta.maxsteps ? parseInt(meta.maxsteps, 10) : (meta.max_steps ? parseInt(meta.max_steps, 10) : null);

      found.push({
        id,
        name: id,
        description: meta.description || `Custom agent: ${id}`,
        systemPrompt: body || `You are the "${id}" subagent. Complete the task carefully.`,
        model: meta.model || null,
        tools,
        readonly: readonly || (tools && tools.every(t =>
          ['read', 'read_file', 'list_directory', 'glob', 'grep', 'fetch_content',
            'web_search', 'finish_task', 'answer_informational_query', 'tool_search'].includes(t)
        )),
        maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : null,
        rel
      });
    }
  } catch (e) {
    console.warn(TAG, 'discover', e?.message || e);
  }

  const map = new Map();
  for (const a of found) map.set(a.id, a);
  return [...map.values()];
}

export async function getCustomAgent(name) {
  const id = String(name || '').replace(/^\//, '').toLowerCase().trim();
  if (!id) return null;
  const list = await discoverCustomAgents();
  return list.find(a => a.id === id || a.name === id) || null;
}

export const CustomAgentsLoader = {
  discoverCustomAgents,
  getCustomAgent,
  ROOT
};
