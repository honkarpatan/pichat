/**
 * Pi toolset: which of the plugin's registered tools the Pi engine exposes,
 * and how to format them for each provider family.
 *
 * Pi philosophy: a tiny core (read / write / edit / bash + search) and everything
 * else is opt-in. Profiles map that onto this plugin's tools:
 *   Pi read  -> read, list_directory, glob, grep
 *   Pi write -> write
 *   Pi edit  -> str_replace (+ edit_file_lines)
 *   Pi bash  -> run_command
 */
import { ToolRegistry } from '../core/tools/ToolRegistry.js';

/** Never exposed in Pi mode: Pi has no finish tool, no deferred loading. */
export const PI_NEVER = new Set(['tool_search', 'finish_task', 'answer_informational_query']);

const CORE = ['read', 'list_directory', 'glob', 'grep', 'write', 'str_replace', 'edit_file_lines', 'run_command'];

/** If the primary tool is absent (e.g. FS-only backend), fall back to its alias. */
const ALIASES = {
  write: ['create_or_update_file'],
  str_replace: ['search_replace_edit']
};

const STANDARD_EXTRA = [
  'outline', 'todo_write', 'ask_user_question', 'subagent', 'fetch_content', 'web_search',
  'load_skill', 'update_project_memory', 'create_folder', 'delete_item',
  'rename_path', 'move_path', 'copy_path', 'preview_html', 'get_diagnostics',
  'apply_patch', 'multi_edit', 'git_status', 'git_diff', 'git_log'
];

export function selectPiToolDecls(app, profile = 'standard') {
  const all = ToolRegistry._allDecls(app) || [];
  const byName = new Map(all.map((d) => [d.name, d]));
  const want = new Set();

  const add = (n) => {
    if (byName.has(n)) { want.add(n); return; }
    (ALIASES[n] || []).forEach((a) => { if (byName.has(a)) want.add(a); });
  };

  if (profile === 'full') {
    all.forEach((d) => { if (!PI_NEVER.has(d.name)) want.add(d.name); });
  } else {
    CORE.forEach(add);
    if (profile !== 'minimal') STANDARD_EXTRA.forEach(add);
  }

  const order = (n) => {
    const i = CORE.indexOf(n);
    return i >= 0 ? i : 100;
  };
  return all.filter((d) => want.has(d.name)).sort((a, b) => order(a.name) - order(b.name));
}

function lowerTypes(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const o = Array.isArray(obj) ? [...obj] : { ...obj };
  if (typeof o.type === 'string') o.type = o.type.toLowerCase();
  if (o.properties) {
    o.properties = { ...o.properties };
    for (const k of Object.keys(o.properties)) o.properties[k] = lowerTypes(o.properties[k]);
  }
  if (o.items) o.items = lowerTypes(o.items);
  return o;
}

function clone(x) {
  return JSON.parse(JSON.stringify(x || { type: 'object', properties: {} }));
}

export function isGeminiLike(modelType, config) {
  const base = String(config?.baseProvider || modelType || '').toLowerCase();
  return base === 'gemini' || base === 'vertex' || modelType === 'vertex';
}

/**
 * Format declarations the same way the rest of the plugin does:
 *   gemini -> [{ functionDeclarations }]   (the Gemini provider sanitizes ARRAY items itself)
 *   claude -> [{ name, description, input_schema }]
 *   other  -> [{ type:'function', function:{...} }]
 */
export function toProviderTools(modelType, config, decls) {
  const base = String(config?.baseProvider || modelType || '').toLowerCase();
  if (base === 'gemini' && modelType !== 'vertex') {
    return [{ functionDeclarations: decls.map((d) => ({ name: d.name, description: d.description, parameters: clone(d.parameters) })) }];
  }
  if (modelType === 'claude') {
    return decls.map((d) => ({
      name: d.name,
      description: d.description,
      input_schema: lowerTypes(clone(d.parameters))
    }));
  }
  return decls.map((d) => ({
    type: 'function',
    function: { name: d.name, description: d.description, parameters: lowerTypes(clone(d.parameters)) }
  }));
}

/** One-line summary for the system prompt tool list. */
export function firstSentence(desc, max = 100) {
  const s = String(desc || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  const out = (m ? m[1] : s);
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}
