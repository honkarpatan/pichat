// src/main/core/tools/ToolRegistry.js
//
// Aicode Harness tool surface (Pi-inspired deferred registry — our code).
// - CORE tools always sent to the model
// - DEFERRED tools loaded via tool_search (saves tokens every turn)
// - ALL_AGENTS kept for executeTool dispatch

import { AcodeFSAgent } from '../../agent/tools/AcodeFSAgent.js';
import { AcodeTerminalAgent } from '../../agent/tools/AcodeTerminalAgent.js';
import { AcodeSettingsAgent } from '../../agent/tools/AcodeSettingsAgent.js';
import { AcodeWorkspaceAgent } from '../../agent/tools/AcodeWorkspaceAgent.js';
import { WebSearchAgent } from '../../agent/tools/WebSearchAgent.js';
import { AcodeEditorAgent } from '../../agent/tools/AcodeEditorAgent.js';
import { AcodeStudyAgent } from '../../agent/tools/AcodeStudyAgent.js';
import { AcodeControlAgent } from '../../agent/tools/AcodeControlAgent.js';
import { AcodeCanvasAgent } from '../../agent/tools/AcodeCanvasAgent.js';
import { AcodePlanAgent } from '../../agent/tools/AcodePlanAgent.js';
import { AskUserAgent, ASK_USER_TOOL } from '../../agent/tools/AskUserAgent.js';
import { PathOpsAgent } from '../../agent/tools/PathOpsAgent.js';
import { SubAgentTool, SUBAGENT_TOOL } from '../../agent/tools/SubAgentTool.js';
import { FetchContentAgent } from '../../agent/tools/FetchContentAgent.js';
import { SkillsAgent } from '../../agent/tools/SkillsAgent.js';
import { CodemodeAgent } from '../../agent/tools/CodemodeAgent.js';
import { RepoMapAgent } from '../../agent/tools/RepoMapAgent.js';
import { TestRunnerAgent } from '../../agent/tools/TestRunnerAgent.js';
import { BackgroundProcessAgent } from '../../agent/tools/BackgroundProcessAgent.js';
import { EditQualityAgent } from '../../agent/tools/EditQualityAgent.js';
import { GitAgent } from '../../agent/tools/GitAgent.js';
import { McpAgent } from '../../agent/mcp/McpHttpClient.js';
import { ConfigManager } from '../../utils/ConfigManager.js';
import { isDryRun, classifyTool } from '../../agent/harness/MutationGate.js';

const ALL_AGENTS = [
  AcodeFSAgent,
  AcodeTerminalAgent,
  AcodeSettingsAgent,
  AcodeWorkspaceAgent,
  WebSearchAgent,
  AcodeEditorAgent,
  AcodeStudyAgent,
  AcodeControlAgent,
  AcodeCanvasAgent,
  AcodePlanAgent,
  AskUserAgent,
  PathOpsAgent,
  SubAgentTool,
  FetchContentAgent,
  SkillsAgent,
  CodemodeAgent,
  RepoMapAgent,
  TestRunnerAgent,
  BackgroundProcessAgent,
  EditQualityAgent,
  GitAgent,
  McpAgent
];

/** Always visible to the model (read/plan/finish/search) */
export const CORE_TOOL_NAMES = new Set([
  'answer_informational_query',
  'read',
  'list_directory',
  'glob',
  'grep',
  'outline',
  'todo_write',
  'finish_task',
  'tool_search',
  'ask_user_question',
  'subagent',
  'fetch_content',
  'load_skill'
]);

/** Loaded on demand via tool_search */
export const DEFERRED_TOOL_NAMES = new Set([
  'write',
  'str_replace',
  'edit_file_lines',
  'delete_item',
  'run_command',
  'update_project_memory',
  'create_folder',
  'create_file_tree',
  'create_or_update_file',
  'search_replace_edit',
  'preview_html',
  'web_search',
  'fetch_educational_images',
  'rename_path',
  'move_path',
  'copy_path',
  'codemode',
  'repo_map',
  'run_tests',
  'background_start',
  'background_list',
  'background_log',
  'background_kill',
  'apply_patch',
  'multi_edit',
  'get_diagnostics',
  'git_status',
  'git_diff',
  'git_log',
  'mcp_list_servers',
  'mcp_list_tools',
  'mcp_call_tool'
]);

/** Short catalog for tool_search results */
const DEFERRED_CATALOG = [
  { name: 'write', summary: 'Create or overwrite a file with full content' },
  { name: 'str_replace', summary: 'Patch an existing file by exact search/replace' },
  { name: 'edit_file_lines', summary: 'Replace a line range in an existing file' },
  { name: 'delete_item', summary: 'Delete a file or folder' },
  { name: 'run_command', summary: 'Run a shell command in the project/terminal' },
  { name: 'update_project_memory', summary: 'Update .aicodex/project_memory.md' },
  { name: 'create_folder', summary: 'Create a directory' },
  { name: 'create_file_tree', summary: 'Create multiple files/folders from a tree' },
  { name: 'preview_html', summary: 'Preview/run HTML in chat canvas' },
  { name: 'web_search', summary: 'Search the web (when browsing enabled)' },
  { name: 'fetch_educational_images', summary: 'Study mode educational images' },
  { name: 'rename_path', summary: 'Rename a file or folder' },
  { name: 'move_path', summary: 'Move a file or folder' },
  { name: 'copy_path', summary: 'Copy a file' },
  { name: 'fetch_content', summary: 'Fetch public http(s) URL as text' },
  { name: 'codemode', summary: 'Run JS snippet with tools.read/write/grep batch API' },
  { name: 'repo_map', summary: 'Project file tree map (.aicodex/repomap.json)' },
  { name: 'run_tests', summary: 'Auto-detect and run project tests (npm/pytest/gradle/…)' },
  { name: 'background_start', summary: 'Start long-running command (dev server)' },
  { name: 'background_list', summary: 'List background processes' },
  { name: 'background_log', summary: 'Tail background process log' },
  { name: 'background_kill', summary: 'Stop background process' },
  { name: 'apply_patch', summary: 'Apply unified diff patch (multi-hunk)' },
  { name: 'multi_edit', summary: 'Multiple search/replace on one file' },
  { name: 'get_diagnostics', summary: 'Syntax/lint hints after edits' },
  { name: 'git_status', summary: 'git status -sb' },
  { name: 'git_diff', summary: 'git diff (optional path/staged)' },
  { name: 'git_log', summary: 'Recent git commits' },
  { name: 'mcp_list_servers', summary: 'List MCP HTTP servers' },
  { name: 'mcp_list_tools', summary: 'List tools on MCP server' },
  { name: 'mcp_call_tool', summary: 'Call MCP tool' }
];

const TOOL_SEARCH_DECL = {
  name: 'tool_search',
  description:
    'Load extra tools that are not in the default set (write, str_replace, edit_file_lines, delete_item, run_command, update_project_memory, preview_html, etc.). Call this BEFORE write/edit/shell when those tools are missing from your available tools. Pass names or a short query like "write edit shell".',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: {
        type: 'STRING',
        description: 'Search text, e.g. "write files", "shell", "delete", or tool names'
      },
      names: {
        type: 'ARRAY',
        description: 'Exact tool names to load',
        items: { type: 'STRING' }
      }
    }
  }
};

/** Model-visible modules this turn (schemas still filtered by core/deferred) */
export function isAdvancedEditEnabledSync() {
  try {
    const v = ConfigManager.get('agentEnableAdvancedEdit');
    return v === true || v === 'true' || v === 1 || v === '1';
  } catch (_) {
    return false;
  }
}

export function selectAgentModules(app) {
  const modules = [AcodeFSAgent, AcodePlanAgent, AcodeControlAgent, AcodeCanvasAgent, AskUserAgent, PathOpsAgent, SubAgentTool, FetchContentAgent, SkillsAgent, CodemodeAgent, RepoMapAgent, TestRunnerAgent, BackgroundProcessAgent, GitAgent, McpAgent];
  if (isAdvancedEditEnabledSync()) modules.push(EditQualityAgent);
  if (app?.isEnableWebBrowsing) modules.push(WebSearchAgent);
  if (app?.isEnableStudyMode) modules.push(AcodeStudyAgent);
  return modules;
}

function deferredEnabled(app) {
  try {
    const v = app?.settingsStore?.get?.('agentDeferredTools', true);
    if (v === false || v === 'false' || v === 0) return false;
  } catch (_) {}
  // Default ON for harness upgrade
  return true;
}

export class ToolRegistry {
  static _lowercaseTypes(obj) {
    if (obj && typeof obj.type === 'string') obj.type = obj.type.toLowerCase();
    if (obj && obj.properties) {
      for (const key in obj.properties) ToolRegistry._lowercaseTypes(obj.properties[key]);
    }
    if (obj && obj.items) ToolRegistry._lowercaseTypes(obj.items);
    return obj;
  }

  static resetLoadedTools(app) {
    if (app) app._agentLoadedTools = new Set();
  }

  static getLoadedToolNames(app) {
    return Array.from(app?._agentLoadedTools || []);
  }

  static loadTools(app, names = []) {
    if (!app) return [];
    if (!app._agentLoadedTools) app._agentLoadedTools = new Set();
    const loaded = [];
    for (const n of names) {
      const name = String(n || '').trim();
      if (!name) continue;
      if (DEFERRED_TOOL_NAMES.has(name) || name === 'web_search') {
        app._agentLoadedTools.add(name);
        loaded.push(name);
      }
    }
    return loaded;
  }

  static executeToolSearch(app, args = {}) {
    const q = String(args.query || '').toLowerCase().trim();
    const explicit = Array.isArray(args.names) ? args.names.map(String) : [];
    let matched = [];
    const adv = isAdvancedEditEnabledSync();
    const allowAdv = (n) =>
      adv || !['apply_patch', 'multi_edit', 'get_diagnostics'].includes(n);

    if (explicit.length) {
      matched = explicit
        .filter(n => DEFERRED_CATALOG.some(c => c.name === n) || DEFERRED_TOOL_NAMES.has(n))
        .filter(allowAdv);
    } else if (q) {
      matched = DEFERRED_CATALOG
        .filter(c => c.name.includes(q) || c.summary.toLowerCase().includes(q) ||
          (q.includes('write') && /write|str_replace|edit/.test(c.name)) ||
          (q.includes('edit') && /str_replace|edit|write/.test(c.name)) ||
          (q.includes('shell') && c.name === 'run_command') ||
          (q.includes('command') && c.name === 'run_command') ||
          (q.includes('delete') && c.name === 'delete_item') ||
          (q.includes('memory') && c.name === 'update_project_memory') ||
          (q.includes('html') && c.name === 'preview_html') ||
          (q.includes('web') && c.name === 'web_search') ||
          (q.includes('rename') && c.name === 'rename_path') ||
          (q.includes('move') && c.name === 'move_path') ||
          (q.includes('copy') && c.name === 'copy_path') ||
          ((q.includes('fetch') || q.includes('url') || q.includes('http')) && c.name === 'fetch_content') ||
          ((q.includes('codemode') || q.includes('batch') || q.includes('script')) && c.name === 'codemode') ||
          ((q.includes('test') || q.includes('pytest') || q.includes('jest') || q.includes('gradle')) && c.name === 'run_tests') ||
          ((q.includes('background') || q.includes('server') || q.includes('dev server')) && c.name.startsWith('background_')) ||
          ((q.includes('patch') || q.includes('diff') || q.includes('multi')) && (c.name === 'apply_patch' || c.name === 'multi_edit')) ||
          (q.includes('diagnostic') && c.name === 'get_diagnostics') ||
          ((q.includes('git') || q.includes('commit') || q.includes('diff')) && c.name.startsWith('git_')))
        .map(c => c.name)
        .filter(allowAdv);
    } else {
      // No query — list catalog without loading
      return {
        success: true,
        loaded: [],
        available: DEFERRED_CATALOG.map(c => `${c.name}: ${c.summary}`),
        message: 'Pass names or query to load tools. Example: tool_search with names ["write","str_replace"]'
      };
    }

    // Dedup
    matched = [...new Set(matched)];
    const loaded = ToolRegistry.loadTools(app, matched);
    return {
      success: true,
      loaded,
      available: DEFERRED_CATALOG.filter(c => loaded.includes(c.name) || matched.includes(c.name))
        .map(c => `${c.name}: ${c.summary}`),
      message: loaded.length
        ? `Loaded tools: ${loaded.join(', ')}. You can use them on the next step.`
        : 'No matching deferred tools. Try names: write, str_replace, edit_file_lines, run_command.'
    };
  }

  static isToolVisible(name, app) {
    if (!name) return false;
    if (!deferredEnabled(app)) return true;
    if (CORE_TOOL_NAMES.has(name)) return true;
    if (app?._agentLoadedTools?.has(name)) return true;
    // Non-classified tools from selected modules: treat as deferred if in DEFERRED set, else core-ish
    if (DEFERRED_TOOL_NAMES.has(name)) return false;
    return true; // plan/control/canvas extras not in deferred list
  }

  static _allDecls(app) {
    const decls = selectAgentModules(app).flatMap(agent => agent.getToolsSchema() || []);
    // Inject tool_search once
    if (!decls.some(d => d.name === 'tool_search')) {
      decls.push(TOOL_SEARCH_DECL);
    }
    return decls;
  }

  static _decls(app) {
    const all = ToolRegistry._allDecls(app);
    if (!deferredEnabled(app)) return all;
    return all.filter(d => ToolRegistry.isToolVisible(d.name, app));
  }

  static getGeminiTools(app = null) {
    // Deep clone so provider sanitize can mutate; fill any ARRAY missing items
    const decls = JSON.parse(JSON.stringify(ToolRegistry._decls(app) || []));
    const fill = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 14) return;
      if (Array.isArray(node)) { node.forEach((x) => fill(x, depth + 1)); return; }
      const type = String(node.type || '').toUpperCase();
      if ((type === 'ARRAY' || type === 'LIST') && (!node.items || typeof node.items !== 'object')) {
        node.items = { type: 'STRING' };
      }
      if (node.properties && typeof node.properties === 'object') {
        for (const [key, val] of Object.entries(node.properties)) {
          if (!val || typeof val !== 'object') continue;
          const vt = String(val.type || '').toUpperCase();
          if (vt === 'ARRAY' || vt === 'LIST' || (!vt && /^(tasks|items|edits|options|questions|names)$/i.test(key))) {
            if (!val.type) val.type = 'ARRAY';
            if (!val.items || typeof val.items !== 'object') val.items = { type: 'STRING' };
          }
          fill(val, depth + 1);
        }
      }
      if (node.items) fill(node.items, depth + 1);
    };
    decls.forEach((d) => { if (d?.parameters) fill(d.parameters); });
    return [{ functionDeclarations: decls }];
  }

  static getGeminiWriteTools(app = null) {
    const WRITE = new Set(['write', 'str_replace']);
    // Ensure write tools are visible for force-write pass
    if (app) ToolRegistry.loadTools(app, ['write', 'str_replace', 'edit_file_lines']);
    const all = ToolRegistry._decls(app);
    let filtered = all.filter(d => d.name === 'write');
    if (!filtered.length) filtered = all.filter(d => WRITE.has(d.name));
    return [{ functionDeclarations: filtered.length ? filtered : all }];
  }

  static getStandardWriteTools(app = null) {
    if (app) ToolRegistry.loadTools(app, ['write', 'str_replace', 'edit_file_lines']);
    const all = ToolRegistry.getStandardTools(app);
    let filtered = all.filter(t => t.function?.name === 'write');
    if (!filtered.length) {
      filtered = all.filter(t => ['write', 'str_replace'].includes(t.function?.name));
    }
    return filtered;
  }

  static getStandardTools(app = null) {
    return ToolRegistry._decls(app).map(decl => {
      const params = ToolRegistry._lowercaseTypes(JSON.parse(JSON.stringify(decl.parameters || { type: 'object', properties: {} })));
      return {
        type: 'function',
        function: {
          name: decl.name,
          description: decl.description,
          parameters: params
        }
      };
    });
  }

  static getClaudeTools(app = null) {
    return ToolRegistry._decls(app).map(decl => {
      const inputSchema = ToolRegistry._lowercaseTypes(JSON.parse(JSON.stringify(decl.parameters || { type: 'object', properties: {} })));
      return {
        name: decl.name,
        description: decl.description,
        input_schema: inputSchema
      };
    });
  }

  static primaryWriteToolName() {
    return 'write';
  }

  static _buildOwnerMap() {
    if (ToolRegistry._toolOwnerMap) return ToolRegistry._toolOwnerMap;
    const map = new Map();
    for (const agent of ALL_AGENTS) {
      const decls = agent.getToolsSchema() || [];
      for (const decl of decls) {
        map.set(decl.name, agent);
      }
    }
    const legacy = [
      'read_file', 'create_or_update_file', 'search_replace_edit', 'edit_file_lines',
      'list_directory', 'create_folder', 'create_file_tree', 'check_exists',
      'delete_item', 'rename_item', 'move_item', 'copy_file', 'run_shell_command'
    ];
    for (const n of legacy) {
      if (!map.has(n)) map.set(n, AcodeFSAgent);
    }
    map.set('get_active_file_content', AcodeEditorAgent);
    map.set('get_open_tabs', AcodeEditorAgent);
    map.set('update_active_file_content', AcodeEditorAgent);
    map.set('tool_search', null); // handled in executeTool
    ToolRegistry._toolOwnerMap = map;
    return map;
  }

  static async executeTool(functionCall, app = null) {
    const name = functionCall?.name;
    // Dry-run: simulate mutating tools without disk writes
    try {
      if (isDryRun() && name && classifyTool(name) !== 'none') {
        console.log('[ToolRegistry] dry-run skip', name);
        return {
          success: true,
          dryRun: true,
          message: `Dry-run: skipped "${name}" (no disk changes).`,
          args: functionCall?.args || {}
        };
      }
    } catch (_) {}
    if (name === 'tool_search') {
      return ToolRegistry.executeToolSearch(app || functionCall?._app, functionCall?.args || {});
    }
    if (name === 'subagent' || name === SUBAGENT_TOOL) {
      return SubAgentTool.executeTool(functionCall, app || functionCall?._app);
    }
    if (name === 'ask_user_question' || name === ASK_USER_TOOL) {
      // Prefer LiveChatUI gate — AgentToolExecution handles this path primarily
      const live = app?.chatHandler?.liveUI || app?.liveUI;
      const parsed = AskUserAgent.parseQuestions(functionCall?.args?.questions);
      if (!parsed.ok) return { success: false, cancelled: true, error: parsed.error };
      if (live?.askUserQuestions) {
        try {
          live.pauseAgentClock?.();
          const result = await live.askUserQuestions(parsed.questions);
          live.resumeAgentClock?.();
          if (result?.cancelled || result?.skipped) {
            return { success: true, cancelled: true, skipped: true, answers: [], message: 'User skipped the questions.' };
          }
          return {
            success: true,
            cancelled: false,
            answers: result.answers || [],
            message: 'User answered. Continue with their choices.'
          };
        } catch (e) {
          try { live.resumeAgentClock?.(); } catch (_) {}
          return { success: false, cancelled: true, error: e?.message || String(e) };
        }
      }
      return { success: false, cancelled: true, error: 'Ask UI unavailable' };
    }
    const ownerMap = ToolRegistry._buildOwnerMap();
    const owner = ownerMap.get(name);
    if (!owner) {
      return { error: `Unknown tool: ${name}` };
    }
    try {
      // Pass app when supported (codemode, subagent-style tools)
      if (owner.executeTool.length >= 2 || name === 'codemode') {
        return await owner.executeTool(functionCall, app || functionCall?._app);
      }
      return await owner.executeTool(functionCall);
    } catch (e) {
      console.error('[ToolRegistry] executeTool threw for', name, e);
      return { error: e?.message || String(e) };
    }
  }
}
