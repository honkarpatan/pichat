/**
 * Load AGENTS.md / CLAUDE.md / .aicodex/project_memory.md into agent context.
 */
import {
  getProjectFolder, readFile, normalizeSafUrl, joinSafPath
} from '../../utils/file/fileOperations.js';
import { skillsCatalogText } from '../../context/SkillsLoader.js';

const CANDIDATES = [
  'AGENTS.md',
  '.agents.md',
  '.agents/AGENTS.md',
  'CLAUDE.md',
  '.aicodex/project_memory.md',
  'project_memory.md' // legacy root
];

const MAX_CHARS = 4000;

async function tryRead(projectUri, rel) {
  try {
    const url = joinSafPath(normalizeSafUrl(projectUri), rel);
    const res = await readFile(url, 'utf-8');
    if (res?.success && typeof res.content === 'string' && res.content.trim()) {
      return { path: rel, text: res.content.trim() };
    }
  } catch (_) {}
  return null;
}

/**
 * @returns {Promise<{ text: string, sources: string[] }>}
 */
export async function loadProjectInstructions() {
  const project = await getProjectFolder();
  if (!project?.uri) return { text: '', sources: [] };

  const parts = [];
  const sources = [];
  let used = 0;

  for (const rel of CANDIDATES) {
    if (used >= MAX_CHARS) break;
    const hit = await tryRead(project.uri, rel);
    if (!hit) continue;
    const budget = MAX_CHARS - used;
    const chunk = hit.text.length > budget
      ? hit.text.slice(0, budget) + '\n…[truncated]'
      : hit.text;
    parts.push(`### ${hit.path}\n${chunk}`);
    sources.push(hit.path);
    used += chunk.length;
  }

  let skillCat = '';
  try {
    skillCat = await skillsCatalogText();
  } catch (_) {}

  if (!parts.length && !skillCat) return { text: '', sources: [] };
  const body = parts.length
    ? `[Project instructions — follow these rules]\n\n${parts.join('\n\n')}`
    : '';
  const extra = skillCat ? (body ? body + '\n\n' + skillCat : skillCat) : body;
  return {
    text: extra,
    sources: skillCat ? sources.concat(['skills-catalog']) : sources
  };
}
