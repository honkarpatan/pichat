/**
 * Declarative agent hooks (.aicodex/hooks.json)
 *
 * {
 *   "UserPromptSubmit": [ { "inject": "text added to agent context" } ],
 *   "PreToolUse": [
 *     { "match": "delete_item", "deny": true, "reason": "Deletes blocked by project hook" },
 *     { "match": "run_command", "matchArgs": "rm*", "deny": true }
 *   ],
 *   "PostToolUse": [ { "match": "write", "audit": true } ],
 *   "AgentStop": [ { "log": true } ]
 * }
 *
 * match / matchArgs: glob (* ?) against tool name / primary arg
 */
import {
  getProjectFolder, readFile, normalizeSafUrl, joinSafPath
} from '../../utils/file/fileOperations.js';

const TAG = '[Hooks]';
const REL = '.aicodex/hooks.json';

let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 4000;

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

function matchGlob(pattern, value) {
  if (!pattern || pattern === '*') return true;
  try {
    return globToRegExp(pattern).test(String(value || ''));
  } catch (_) {
    return String(value || '').toLowerCase().includes(String(pattern).toLowerCase());
  }
}

function primaryArg(toolName, args = {}) {
  const n = String(toolName || '');
  const a = args || {};
  if (n === 'run_command' || n === 'run_shell_command' || n === 'run_tests') {
    return String(a.command || a.cmd || '');
  }
  return String(a.path || a.sourcePath || a.url || '');
}

export async function loadHooks(force = false) {
  const now = Date.now();
  if (!force && _cache && now - _cacheAt < CACHE_MS) return _cache;

  const empty = {
    UserPromptSubmit: [],
    PreToolUse: [],
    PostToolUse: [],
    AgentStop: []
  };

  try {
    const project = await getProjectFolder();
    if (!project?.uri) {
      _cache = empty;
      _cacheAt = now;
      return empty;
    }
    const r = await readFile(normalizeSafUrl(joinSafPath(project.uri, REL)), 'utf-8');
    if (!r?.success || !r.content) {
      _cache = empty;
      _cacheAt = now;
      return empty;
    }
    const j = JSON.parse(r.content);
    _cache = {
      UserPromptSubmit: Array.isArray(j.UserPromptSubmit) ? j.UserPromptSubmit : [],
      PreToolUse: Array.isArray(j.PreToolUse) ? j.PreToolUse : [],
      PostToolUse: Array.isArray(j.PostToolUse) ? j.PostToolUse : [],
      AgentStop: Array.isArray(j.AgentStop) ? j.AgentStop : []
    };
    _cacheAt = now;
    console.log(TAG, 'loaded', REL,
      'pre=', _cache.PreToolUse.length,
      'prompt=', _cache.UserPromptSubmit.length);
    return _cache;
  } catch (e) {
    console.warn(TAG, 'load failed', e?.message || e);
    _cache = empty;
    _cacheAt = now;
    return empty;
  }
}

/**
 * @returns {{ injectTexts: string[] }}
 */
export async function runUserPromptSubmitHooks(userText) {
  const hooks = await loadHooks();
  const injectTexts = [];
  for (const h of hooks.UserPromptSubmit || []) {
    if (h && typeof h.inject === 'string' && h.inject.trim()) {
      injectTexts.push(h.inject.trim());
    }
  }
  return { injectTexts };
}

/**
 * @returns {{ deny: boolean, reason?: string, matched?: object }}
 */
export async function runPreToolUseHooks(toolName, args = {}) {
  const hooks = await loadHooks();
  const name = String(toolName || '');
  const arg = primaryArg(name, args);

  for (const h of hooks.PreToolUse || []) {
    if (!h || typeof h !== 'object') continue;
    const mTool = h.match || h.tool || '*';
    if (!matchGlob(mTool, name)) continue;
    if (h.matchArgs && !matchGlob(h.matchArgs, arg)) continue;

    if (h.deny === true || h.block === true) {
      return {
        deny: true,
        reason: h.reason || `Blocked by PreToolUse hook (match=${mTool})`,
        matched: h
      };
    }
    // Optional inject note for model — returned for logging only here
  }
  return { deny: false };
}

/**
 * Post-tool side effects (audit log)
 */
export async function runPostToolUseHooks(toolName, args = {}, result = {}) {
  const hooks = await loadHooks();
  const name = String(toolName || '');
  const arg = primaryArg(name, args);

  for (const h of hooks.PostToolUse || []) {
    if (!h || typeof h !== 'object') continue;
    const mTool = h.match || h.tool || '*';
    if (!matchGlob(mTool, name)) continue;
    if (h.matchArgs && !matchGlob(h.matchArgs, arg)) continue;

    if (h.audit === true || h.log === true) {
      try {
        const { appendMutationAudit } = await import('./MutationAudit.js');
        await appendMutationAudit({
          tool: name,
          path: arg || args?.path || '',
          ok: !(result?.error || result?.rejected),
          dryRun: !!result?.dryRun,
          hook: true
        });
      } catch (_) {}
    }
  }
}

export async function runAgentStopHooks(app, status = 'done') {
  const hooks = await loadHooks();
  for (const h of hooks.AgentStop || []) {
    if (!h) continue;
    if (h.log === true) {
      console.log(TAG, 'AgentStop', status);
    }
  }
}

export function invalidateHooksCache() {
  _cache = null;
  _cacheAt = 0;
}

export const AgentHooks = {
  loadHooks,
  runUserPromptSubmitHooks,
  runPreToolUseHooks,
  runPostToolUseHooks,
  runAgentStopHooks,
  invalidateHooksCache,
  REL
};
