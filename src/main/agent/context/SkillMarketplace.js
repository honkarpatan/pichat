/**
 * Local skill "marketplace" templates → install into .aicodex/skills
 */
import {
  getProjectFolder, createFolder, createFile, listDir, normalizeSafUrl, joinSafPath
} from '../../utils/file/fileOperations.js';

export const BUNDLED_SKILLS = [
  {
    id: 'code-review',
    name: 'code-review',
    description: 'Review code for bugs and style',
    body: `---
name: code-review
description: Review code for bugs, security, and clarity
---
You are a careful code reviewer. List issues by severity. Suggest minimal fixes. Do not rewrite whole files.
`
  },
  {
    id: 'write-tests',
    name: 'write-tests',
    description: 'Propose unit tests for a module',
    body: `---
name: write-tests
description: Propose focused unit tests
---
Write practical unit tests for the target module. Prefer small cases. Match project test runner if known.
`
  },
  {
    id: 'explain-code',
    name: 'explain-code',
    description: 'Explain a file in plain language',
    body: `---
name: explain-code
description: Explain code structure and flow
---
Explain what the code does, main entry points, and data flow. Keep it concise.
`
  }
];

export function listMarketplaceSkills() {
  return BUNDLED_SKILLS.map(s => ({ id: s.id, name: s.name, description: s.description }));
}

export async function installSkill(id) {
  const skill = BUNDLED_SKILLS.find(s => s.id === id || s.name === id);
  if (!skill) return { success: false, error: `Unknown skill: ${id}` };
  const project = await getProjectFolder();
  if (!project?.uri) return { success: false, error: 'No project' };
  const folder = `.aicodex/skills/${skill.name}`;
  await createFolder(project.uri, '.aicodex', { overwrite: true });
  await createFolder(project.uri, '.aicodex/skills', { overwrite: true });
  await createFolder(project.uri, folder, { overwrite: true });
  const rel = `${folder}/SKILL.md`;
  const w = await createFile(project.uri, rel, skill.body, { overwrite: true });
  return { success: !!w?.success, path: rel, name: skill.name };
}

export async function listInstalledSkills() {
  const project = await getProjectFolder();
  if (!project?.uri) return [];
  try {
    const listed = await listDir(normalizeSafUrl(joinSafPath(project.uri, '.aicodex/skills')));
    if (!listed?.success) return [];
    return (listed.entries || []).map(e => e.name || e).filter(Boolean);
  } catch (_) {
    return [];
  }
}
