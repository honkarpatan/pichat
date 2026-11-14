/**
 * Skills loader — default: .aicodex/skills/<name>/SKILL.md
 * Configurable via settings key `agentSkillsPaths` (comma/newline separated relative roots).
 */
import { getProjectFolder, listDir, readFile, normalizeSafUrl, joinSafPath } from '../utils/file/fileOperations.js';
import { ConfigManager } from '../utils/ConfigManager.js';

const TAG = '[SkillsLoader]';
const MAX_SKILL_CHARS = 12000;
const DEFAULT_ROOTS = ['.aicodex/skills'];
const SKILL_FILENAMES = ['SKILL.md', 'skill.md', 'Skill.md'];

function getConfiguredRoots() {
  let raw = '';
  try {
    raw = ConfigManager.get('agentSkillsPaths');
  } catch (_) {}
  if (raw == null || String(raw).trim() === '') {
    return [...DEFAULT_ROOTS];
  }
  const parts = String(raw)
    .split(/[\n,;]+/)
    .map(s => s.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  // Dedupe, keep order
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.length ? out : [...DEFAULT_ROOTS];
}

async function tryRead(url) {
  try {
    const r = await readFile(url, 'utf-8');
    if (r?.success && typeof r.content === 'string' && r.content.trim()) {
      return r.content;
    }
  } catch (_) {}
  return null;
}

async function listEntries(dirUrl) {
  try {
    const listed = await listDir(normalizeSafUrl(dirUrl));
    if (listed?.success && Array.isArray(listed.entries)) return listed.entries;
  } catch (e) {
    console.warn(TAG, 'listDir failed', String(dirUrl).slice(-60), e?.message || e);
  }
  return [];
}

/** Read first matching SKILL.md / skill.md under folder */
async function readSkillFile(projectUri, skillDirRel) {
  for (const fname of SKILL_FILENAMES) {
    const rel = skillDirRel.replace(/\/+$/, '') + '/' + fname;
    const content = await tryRead(joinSafPath(projectUri, rel));
    if (content != null) return { rel, content };
  }
  return null;
}

/**
 * @returns {Promise<Array<{ name: string, path: string }>>}
 */
export async function discoverSkills() {
  const project = await getProjectFolder();
  if (!project?.uri) {
    console.warn(TAG, 'no project folder');
    return [];
  }
  const roots = getConfiguredRoots();
  const found = new Map(); // name -> path to skill file

  console.log(TAG, 'roots=', roots.join(' | '), 'project=', project.name || '');

  for (const root of roots) {
    // Special: "." means each top-level folder that contains SKILL.md
    if (root === '.' || root === './') {
      const top = await listEntries(project.uri);
      for (const e of top) {
        if (!e?.isDirectory || !e.name) continue;
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const hit = await readSkillFile(project.uri, e.name);
        if (hit && !found.has(e.name)) found.set(e.name, hit.rel);
      }
      continue;
    }

    const rootUrl = joinSafPath(project.uri, root);
    const entries = await listEntries(rootUrl);

    // Case A: root lists subdirs (each skill is a folder)
    if (entries.length) {
      for (const e of entries) {
        if (!e?.name) continue;
        if (e.isDirectory) {
          const skillDirRel = root + '/' + e.name;
          const hit = await readSkillFile(project.uri, skillDirRel);
          if (hit && !found.has(e.name)) {
            found.set(e.name, hit.rel);
          }
        } else if (/^skill\.md$/i.test(e.name)) {
          // Ignore orphan SKILL.md directly under the skills root (must be <name>/SKILL.md)
          console.log(TAG, 'skip orphan', root + '/' + e.name);
        }
      }
    } else {
      // listDir empty/failed — try probing common names via direct read is hard;
      // still try reading root/SKILL.md as one skill named after last segment
      const hit = await readSkillFile(project.uri, root);
      if (hit) {
        const name = root.split('/').filter(Boolean).pop() || 'skill';
        if (!found.has(name)) found.set(name, hit.rel);
      }
    }
  }

  const out = [...found.entries()].map(([name, path]) => ({ name, path }));
  out.sort((a, b) => a.name.localeCompare(b.name));
  console.log(TAG, 'discover →', out.map(x => x.name + '@' + x.path).join(', ') || '(none)');
  return out;
}

export async function listSkills() {
  return (await discoverSkills()).map(x => x.name);
}

export async function loadSkill(name) {
  const skill = String(name || '').trim().replace(/[^a-zA-Z0-9._-]/g, '');
  if (!skill) return { success: false, error: 'Missing skill name' };
  const project = await getProjectFolder();
  if (!project?.uri) return { success: false, error: 'No project folder open' };

  const roots = getConfiguredRoots();
  const discovered = await discoverSkills();
  const hit = discovered.find(x => x.name.toLowerCase() === skill.toLowerCase());
  if (hit) {
    const content = await tryRead(joinSafPath(project.uri, hit.path));
    if (content != null) {
      const body = content.length > MAX_SKILL_CHARS
        ? content.slice(0, MAX_SKILL_CHARS) + '\n…[truncated]'
        : content;
      console.log(TAG, 'loaded', hit.path, 'chars=', body.length);
      return {
        success: true,
        name: hit.name,
        path: hit.path,
        content: body,
        truncated: content.length > MAX_SKILL_CHARS
      };
    }
  }

  // Direct probe under each configured root (listDir may have failed)
  for (const root of roots) {
    if (root === '.' || root === './') {
      const direct = await readSkillFile(project.uri, skill);
      if (direct) {
        const body = direct.content.length > MAX_SKILL_CHARS
          ? direct.content.slice(0, MAX_SKILL_CHARS) + '\n…[truncated]'
          : direct.content;
        return { success: true, name: skill, path: direct.rel, content: body };
      }
      continue;
    }
    const direct = await readSkillFile(project.uri, root + '/' + skill);
    if (direct) {
      const body = direct.content.length > MAX_SKILL_CHARS
        ? direct.content.slice(0, MAX_SKILL_CHARS) + '\n…[truncated]'
        : direct.content;
      return { success: true, name: skill, path: direct.rel, content: body };
    }
  }

  return {
    success: false,
    error:
      'Skill "' + skill + '" not found under: ' + roots.join(', ') +
      '. Expected: <root>/' + skill + '/SKILL.md',
    available: discovered.map(x => x.name),
    roots
  };
}

export async function skillsCatalogText() {
  try {
    const items = await discoverSkills();
    if (!items.length) return '';
    const roots = getConfiguredRoots();
    return (
      '[Available skills — roots: ' + roots.join(', ') + ' — call load_skill with name]\n' +
      items.map(x => '- ' + x.name + ' (' + x.path + ')').join('\n')
    );
  } catch (_) {
    return '';
  }
}

export function getSkillsRoots() {
  return getConfiguredRoots();
}

export const SkillsLoader = {
  listSkills,
  loadSkill,
  skillsCatalogText,
  discoverSkills,
  getSkillsRoots
};
