/**
 * Lightweight sequential codemode runner (Pi codemode idea — our sandbox).
 * IMPORTANT: Do NOT use AsyncFunction constructor — Babel/webpack often
 * collapses it to Function, causing "await is not defined" on device.
 * Instead: new Function returns a Promise via a runtime-parsed async IIFE string.
 */
import { ToolRegistry } from '../../core/tools/ToolRegistry.js';
import { evaluateMutation, grantSessionTool } from '../harness/MutationGate.js';

const TAG = '[Codemode]';
const MAX_CODE_CHARS = 20_000;
const MAX_CALLS = 60;
const TIMEOUT_MS = 60_000;

const ALLOWED = {
  read: { name: 'read', map: (a) => ({ path: a.path || a, start_line: a.start_line, end_line: a.end_line }) },
  list_directory: { name: 'list_directory', map: (a) => ({ path: a.path || a || '.' }) },
  glob: { name: 'glob', map: (a) => (typeof a === 'string' ? { pattern: a } : { pattern: a.pattern, path: a.path }) },
  grep: { name: 'grep', map: (a) => ({ pattern: a.pattern || a, path: a.path }) },
  write: { name: 'write', map: (a) => ({ path: a.path, content: a.content }) },
  str_replace: { name: 'str_replace', map: (a) => ({ path: a.path, search: a.search, replace: a.replace }) },
  edit_file_lines: { name: 'edit_file_lines', map: (a) => a },
  delete_item: { name: 'delete_item', map: (a) => ({ path: a.path || a }) },
  create_folder: { name: 'create_folder', map: (a) => ({ path: a.path || a }) },
  fetch_content: { name: 'fetch_content', map: (a) => ({ url: a.url || a }) },
  git_status: { name: 'git_status', map: () => ({}) },
  git_diff: { name: 'git_diff', map: (a) => ({ path: a.path, staged: a.staged }) },
  update_project_memory: { name: 'update_project_memory', map: (a) => a }
};

function stripDangerous(code) {
  const s = String(code || '');
  // Only flag real calls, not the word "process" in comments/strings loosely —
  // but still block require( import( eval( Function(
  if (/\brequire\s*\(|\bimport\s*\(|\beval\s*\(|\bnew\s+Function\s*\(|\bprocess\.|globalThis\.|window\.|document\./i.test(s)) {
    return { ok: false, error: 'Codemode blocks require/import/eval/process/DOM. Use the tools API only.' };
  }
  if (/\bfetch\s*\(/.test(s) && !/tools\.fetch_content/.test(s)) {
    return { ok: false, error: 'Bare fetch() is blocked. Use await tools.fetch_content(url).' };
  }
  if (s.length > MAX_CODE_CHARS) {
    return { ok: false, error: `Code too long (max ${MAX_CODE_CHARS} chars)` };
  }
  return { ok: true, code: s };
}

/** Promote plain functions so await inside them is legal */
function prepareUserCode(code) {
  let c = String(code || '').trim();
  c = c.replace(/(^|[^\.\w])function\s+([A-Za-z_$][\w$]*)\s*\(/g, '$1async function $2(');
  c = c.replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\(/g, '$1 $2 = async function (');
  return c;
}

function normalizeResult(toolName, result) {
  if (result == null) return result;
  if (result.error) return result;
  if (toolName === 'read') {
    if (typeof result.content === 'string') return result.content;
    if (typeof result === 'string') return result;
    return result;
  }
  if (toolName === 'list_directory') {
    if (Array.isArray(result.entries)) return result.entries;
    if (Array.isArray(result)) return result;
    return result;
  }
  if (toolName === 'fetch_content' && typeof result.content === 'string') return result.content;
  if (toolName === 'grep' && Array.isArray(result.matches)) return result.matches;
  return result;
}

/**
 * @param {object} app
 * @param {string} code
 * @param {{ onCall?: Function }} [opts]
 */
export async function runCodemode(app, code, opts = {}) {
  const check = stripDangerous(code);
  if (!check.ok) return { success: false, error: check.error };

  const calls = [];
  let callCount = 0;

  const tools = {};
  for (const [key, spec] of Object.entries(ALLOWED)) {
    tools[key] = async (arg) => {
      callCount++;
      if (callCount > MAX_CALLS) {
        throw new Error(`Codemode exceeded max tool calls (${MAX_CALLS})`);
      }
      const args = spec.map(arg == null ? {} : arg);
      const fc = { name: spec.name, args, id: `cm-${callCount}` };

      let decision = evaluateMutation(app, spec.name, spec.args || {});
      try {
        const { matchPermissionRules } = await import('../harness/PatternPermissions.js');
        const hit = await matchPermissionRules(spec.name, spec.args || {});
        if (hit.decision === 'deny') {
          decision = { needPrompt: false, blocked: true, category: decision.category, reason: 'Denied by pattern: ' + hit.pattern };
        } else if (hit.decision === 'allow') {
          decision = { needPrompt: false, blocked: false, category: decision.category };
        }
      } catch (_) {}
      if (decision.blocked) {
        const err = { error: decision.reason, blocked: true };
        calls.push({ tool: spec.name, args, ok: false, error: err.error });
        return err;
      }
      if (decision.needPrompt) {
        const liveUI = app?.chatHandler?.liveUI;
        if (liveUI?.askForPermission) {
          const permission = await liveUI.askForPermission(fc, `cm-${callCount}`);
          if (!permission?.granted) {
            const err = { error: 'User rejected codemode tool call', rejected: true };
            calls.push({ tool: spec.name, args, ok: false, error: err.error });
            return err;
          }
          grantSessionTool(app, spec.name);
        }
      }

      try {
        ToolRegistry.loadTools(app, [spec.name]);
      } catch (_) {}

      const result = await ToolRegistry.executeTool(fc, app);
      const ok = !(result && result.error);
      calls.push({ tool: spec.name, args, ok, error: result?.error || null });
      opts.onCall?.({ tool: spec.name, callCount, result });
      return normalizeResult(spec.name, result);
    };
  }

  tools.list = tools.list_directory;
  tools.replace = tools.str_replace;

  const logs = [];
  tools.log = (...a) => {
    const line = a.map(x => {
      if (typeof x === 'string') return x;
      try { return JSON.stringify(x); } catch (_) { return String(x); }
    }).join(' ');
    logs.push(line);
    if (logs.length > 50) logs.splice(0, logs.length - 50);
  };

  const userBody = prepareUserCode(check.code);

  // Runtime-native async IIFE inside a string — Babel does not transform this string,
  // so await works even when AsyncFunction constructor is broken in the bundle.
  const factorySrc =
    'return (async function(__tools){\n' +
    '"use strict";\n' +
    'var tools = __tools;\n' +
    userBody +
    '\n})(tools);';

  let returnValue;
  const timer = new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`Codemode timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
  );

  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function('tools', factorySrc);
    returnValue = await Promise.race([factory(tools), timer]);
  } catch (e) {
    console.warn(TAG, 'run error', e?.message || e);
    return {
      success: false,
      error: e?.message || String(e),
      calls,
      callCount,
      logs: logs.slice(-20)
    };
  }

  console.log(TAG, 'done calls=', callCount);
  return {
    success: true,
    returnValue: returnValue === undefined ? null : returnValue,
    calls,
    callCount,
    logs: logs.slice(-20),
    message: `Codemode finished (${callCount} tool call${callCount === 1 ? '' : 's'}).`
  };
}
