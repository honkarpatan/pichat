/**
 * Pattern-based allow/deny rules (OpenCode/Claude-style).
 * Patterns: "toolName" | "toolName(*)" | "toolName(npm test*)" | "run_command(rm*)"
 * Stored in .aicodex/permissions.json and/or settings text.
 */
import { ConfigManager } from '../../utils/ConfigManager.js';
import {
  getProjectFolder, createFolder, createFile, readFile,
  normalizeSafUrl, joinSafPath
} from '../../utils/file/fileOperations.js';

const TAG = '[PatternPerms]';
export const REL = '.aicodex/permissions.json';

const DEFAULTS = {
  version: 1,
  allow: [],
  deny: [
    'run_command(rm*)',
    'run_command(*rm -rf*)',
    'run_shell_command(rm*)',
    'delete_item(*)'
  ]
};

let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 3000;

function globToRegExp(glob) {
  const s = String(glob || '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else if ('\\.[]{}()+-^$|'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp('^' + out + '$', 'i');
}

/**
 * Parse "tool(argPattern)" or "tool"
 * @returns {{ tool: string, arg: string|null }}
 */
export function parsePattern(pattern) {
  const raw = String(pattern || '').trim();
  if (!raw) return null;
  const m = raw.match(/^([a-zA-Z0-9_]+)\s*(?:\((.*)\))?$/);
  if (!m) return { tool: raw, arg: null };
  return {
    tool: m[1],
    arg: m[2] !== undefined ? m[2] : null
  };
}

/**
 * Primary arg string for matching (command or path).
 */
export function primaryArg(toolName, args = {}) {
  const n = String(toolName || '');
  const a = args || {};
  if (n === 'run_command' || n === 'run_shell_command' || n === 'run_tests') {
    return String(a.command || a.cmd || '').trim();
  }
  if (a.path) return String(a.path).trim();
  if (a.sourcePath) return String(a.sourcePath).trim();
  if (a.url) return String(a.url).trim();
  if (a.code) return String(a.code).slice(0, 120);
  return '';
}

/**
 * Suggest a durable pattern for "Always allow".
 */
export function suggestPattern(toolName, args = {}) {
  const arg = primaryArg(toolName, args);
  if (!arg) return `${toolName}(*)`;
  // shell: keep first tokens for npm/yarn/pnpm/pytest etc.
  if (toolName === 'run_command' || toolName === 'run_shell_command' || toolName === 'run_tests') {
    const toks = arg.split(/\s+/).filter(Boolean);
    if (toks.length >= 2 && /^(npm|yarn|pnpm|bun)$/i.test(toks[0])) {
      // npm test*, npm run build*
      return `${toolName}(${toks[0]} ${toks[1]}*)`;
    }
    if (toks[0]) return `${toolName}(${toks[0]}*)`;
  }
  // path: match basename or prefix
  const base = arg.split(/[/\\]/).filter(Boolean).pop() || arg;
  if (base.includes('.')) return `${toolName}(*${base})`;
  return `${toolName}(*${base}*)`;
}

export function matchPattern(pattern, toolName, args = {}) {
  const parsed = parsePattern(pattern);
  if (!parsed) return false;
  if (parsed.tool.toLowerCase() !== String(toolName || '').toLowerCase()) return false;
  if (parsed.arg === null || parsed.arg === undefined) return true; // tool-only match
  const val = primaryArg(toolName, args);
  // empty arg pattern (*) matches any
  if (parsed.arg === '*' || parsed.arg === '') return true;
  try {
    return globToRegExp(parsed.arg).test(val);
  } catch (_) {
    return val.toLowerCase().includes(String(parsed.arg).toLowerCase());
  }
}

function parseListSetting(key) {
  try {
    const raw = ConfigManager.get(key);
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String);
    return String(raw)
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * Load merged rules: project file + settings textareas
 */
export async function loadPermissionRules(force = false) {
  const now = Date.now();
  if (!force && _cache && now - _cacheAt < CACHE_MS) return _cache;

  let fileRules = { allow: [], deny: [] };
  try {
    const project = await getProjectFolder();
    if (project?.uri) {
      const r = await readFile(normalizeSafUrl(joinSafPath(project.uri, REL)), 'utf-8');
      if (r?.success && r.content) {
        const j = JSON.parse(r.content);
        fileRules.allow = Array.isArray(j.allow) ? j.allow.map(String) : [];
        fileRules.deny = Array.isArray(j.deny) ? j.deny.map(String) : [];
      }
    }
  } catch (_) {}

  const settingsAllow = parseListSetting('agentPermissionAllow');
  const settingsDeny = parseListSetting('agentPermissionDeny');

  // Defaults only if nothing configured
  const deny =
    fileRules.deny.length || settingsDeny.length
      ? [...fileRules.deny, ...settingsDeny]
      : [...DEFAULTS.deny];
  const allow = [...fileRules.allow, ...settingsAllow];

  _cache = {
    allow: [...new Set(allow)],
    deny: [...new Set(deny)],
    source: REL
  };
  _cacheAt = now;
  return _cache;
}

export async function saveProjectPermissions(partial) {
  const project = await getProjectFolder();
  if (!project?.uri) return { success: false, error: 'No project' };

  let current = { version: 1, allow: [], deny: [] };
  try {
    const r = await readFile(normalizeSafUrl(joinSafPath(project.uri, REL)), 'utf-8');
    if (r?.success && r.content) current = { ...current, ...JSON.parse(r.content) };
  } catch (_) {}

  if (Array.isArray(partial.allow)) current.allow = partial.allow;
  if (Array.isArray(partial.deny)) current.deny = partial.deny;
  current.version = 1;
  current.updatedAt = new Date().toISOString();

  await createFolder(project.uri, '.aicodex', { overwrite: true });
  const w = await createFile(
    project.uri,
    REL,
    JSON.stringify(current, null, 2),
    { overwrite: true }
  );
  _cache = null;
  console.log(TAG, 'saved', REL, 'allow', current.allow?.length, 'deny', current.deny?.length);
  return { success: !!w?.success, path: REL, rules: current };
}

export async function addAllowPattern(pattern) {
  const rules = await loadPermissionRules(true);
  const p = String(pattern || '').trim();
  if (!p) return { success: false, error: 'Empty pattern' };
  // Prefer project file
  const allow = [...new Set([...(rules.allow || []), p])];
  // Keep existing deny from file only - reload file
  let fileDeny = DEFAULTS.deny;
  try {
    const project = await getProjectFolder();
    if (project?.uri) {
      const r = await readFile(normalizeSafUrl(joinSafPath(project.uri, REL)), 'utf-8');
      if (r?.success && r.content) {
        const j = JSON.parse(r.content);
        if (Array.isArray(j.deny)) fileDeny = j.deny;
        if (Array.isArray(j.allow)) {
          // merge
        }
      }
    }
  } catch (_) {}
  return saveProjectPermissions({ allow, deny: fileDeny });
}

export async function addDenyPattern(pattern) {
  const rules = await loadPermissionRules(true);
  const p = String(pattern || '').trim();
  if (!p) return { success: false, error: 'Empty pattern' };
  let fileAllow = [];
  try {
    const project = await getProjectFolder();
    if (project?.uri) {
      const r = await readFile(normalizeSafUrl(joinSafPath(project.uri, REL)), 'utf-8');
      if (r?.success && r.content) {
        const j = JSON.parse(r.content);
        if (Array.isArray(j.allow)) fileAllow = j.allow;
        if (Array.isArray(j.deny)) {
          return saveProjectPermissions({
            allow: fileAllow,
            deny: [...new Set([...j.deny, p])]
          });
        }
      }
    }
  } catch (_) {}
  return saveProjectPermissions({
    allow: fileAllow,
    deny: [...new Set([...(rules.deny || []), p])]
  });
}

/**
 * @returns {'allow'|'deny'|null}
 */
export async function matchPermissionRules(toolName, args = {}) {
  const rules = await loadPermissionRules();
  // Deny wins
  for (const p of rules.deny || []) {
    if (matchPattern(p, toolName, args)) {
      return { decision: 'deny', pattern: p };
    }
  }
  for (const p of rules.allow || []) {
    if (matchPattern(p, toolName, args)) {
      return { decision: 'allow', pattern: p };
    }
  }
  return { decision: null, pattern: null };
}

export const PatternPermissions = {
  loadPermissionRules,
  saveProjectPermissions,
  addAllowPattern,
  addDenyPattern,
  matchPermissionRules,
  matchPattern,
  suggestPattern,
  primaryArg,
  parsePattern,
  DEFAULTS,
  REL
};
