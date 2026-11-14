/**
 * Permissions triad (Pi/Official-style):
 *  - ask   — every mutation needs Accept
 *  - edits — auto write/str_replace/edit; ask delete/shell/settings/path destructive
 *  - full  — auto all allowed tools (still respects agentAllowDelete/Terminal flags)
 *  - plan  — research only; all mutations blocked until user Approves plan
 *
 * Session grants: after Accept once for a tool name, skip prompts for rest of run.
 */
import { ConfigManager } from '../../utils/ConfigManager.js';

export function isDryRun() {
  const v = ConfigManager.get('agentDryRun');
  return v === true || v === 'true' || v === 1 || v === '1';
}

const TAG = '[MutationGate]';

/** Tools that never need permission */
export const READ_ONLY_TOOLS = new Set([
  'read', 'read_file', 'list_directory', 'glob', 'grep', 'outline',
  'answer_informational_query', 'web_search', 'fetch_content',
  'tool_search', 'todo_write', 'finish_task', 'subagent',
  'ask_user_question', 'check_exists', 'preview_html',
  'background_list', 'background_log', 'get_diagnostics',
  'git_status', 'git_diff', 'git_log',
  'mcp_list_servers', 'mcp_list_tools'
]);

/** File content mutations */
export const EDIT_TOOLS = new Set([
  'write', 'create_or_update_file', 'str_replace', 'search_replace_edit',
  'edit_file_lines', 'create_folder', 'create_file_tree',
  'update_project_memory', 'rename_path', 'move_path', 'copy_path', 'codemode',
  'apply_patch', 'multi_edit'
]);

export const DELETE_TOOLS = new Set(['delete_item']);

export const SHELL_TOOLS = new Set(['run_command', 'run_tests', 'run_shell_command', 'background_start', 'background_kill']);

export const SETTINGS_TOOLS = new Set([]); // reserved

/**
 * @returns {'ask'|'edits'|'full'|'plan'}
 */
export function getPermissionMode() {
  const mode = String(ConfigManager.get('agentPermissionMode') || '').toLowerCase();
  if (mode === 'ask' || mode === 'edits' || mode === 'full' || mode === 'plan') return mode;

  // Backward compat with old toggles
  const auto = ConfigManager.get('agentAutoExecuteWrites');
  const autoOn = auto === true || auto === 'true' || auto === 1 || auto === '1';
  return autoOn ? 'edits' : 'ask';
}

function isDeleteAllowed() {
  const v = ConfigManager.get('agentAllowDelete');
  if (v === null || v === undefined) return false;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function isTerminalAllowed() {
  const v = ConfigManager.get('agentAllowTerminal');
  if (v === null || v === undefined) return true;
  return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * Classify mutation category for a tool name.
 * @returns {'none'|'edit'|'delete'|'shell'|'settings'}
 */
export function classifyTool(name) {
  const n = String(name || '');
  if (!n || READ_ONLY_TOOLS.has(n)) return 'none';
  if (DELETE_TOOLS.has(n)) return 'delete';
  if (SHELL_TOOLS.has(n)) return 'shell';
  if (SETTINGS_TOOLS.has(n)) return 'settings';
  if (EDIT_TOOLS.has(n)) return 'edit';
  // Unknown mutating tools → treat as edit (safe default: ask in ask mode)
  if (/write|edit|create|update|delete|run_|move|rename|copy/i.test(n)) return 'edit';
  return 'none';
}

function sessionGrants(app) {
  if (!app._mutationSessionGrants) app._mutationSessionGrants = new Set();
  return app._mutationSessionGrants;
}

export function grantSessionTool(app, toolName) {
  if (!toolName) return;
  sessionGrants(app).add(String(toolName));
}

export function clearSessionGrants(app) {
  if (app) app._mutationSessionGrants = new Set();
}

/**
 * Whether this tool call needs an Accept/Reject prompt.
 * @returns {{ needPrompt: boolean, blocked?: boolean, reason?: string, category: string }}
 */
export function evaluateMutation(app, toolName, _args = {}) {
  const category = classifyTool(toolName);
  if (category === 'none') {
    return { needPrompt: false, category };
  }

  // Plan mode: block every mutation (research only)
  const modeEarly = getPermissionMode();
  if (modeEarly === 'plan') {
    return {
      needPrompt: false,
      blocked: true,
      category,
      reason:
        'Plan mode is ON — mutations are blocked. Research with read/list/grep/todo_write only. ' +
        'Call finish_task when the plan is ready for user approval.'
    };
  }

  // Hard blocks from settings
  if (category === 'delete' && !isDeleteAllowed()) {
    return {
      needPrompt: false,
      blocked: true,
      category,
      reason: 'File deletion is disabled in Agent Settings (Allow File Deletion).'
    };
  }
  if (category === 'shell' && !isTerminalAllowed()) {
    return {
      needPrompt: false,
      blocked: true,
      category,
      reason: 'Terminal access is disabled in Agent Settings.'
    };
  }

  const mode = getPermissionMode();
  const grants = sessionGrants(app);
  if (grants.has(String(toolName)) || grants.has(`cat:${category}`)) {
    return { needPrompt: false, category, sessionGrant: true };
  }

  if (mode === 'full') {
    return { needPrompt: false, category };
  }

  if (mode === 'edits') {
    // Auto edits; still ask for delete / shell / settings
    if (category === 'edit') return { needPrompt: false, category };
    return { needPrompt: true, category };
  }

  // mode === 'ask'
  return { needPrompt: true, category };
}

export const MutationGate = {
  getPermissionMode,
  classifyTool,
  evaluateMutation,
  grantSessionTool,
  clearSessionGrants,
  isDryRun,
  READ_ONLY_TOOLS,
  EDIT_TOOLS,
  DELETE_TOOLS,
  SHELL_TOOLS
};
