// src/main/agent/main/AgentToolExecution.js
//
// Executes ONE tool call end-to-end: log "running" → branch (create_file_tree
// sequential-confirm / permission-gated mutation / direct execute) → log
// "done"/"error" with full metadata (diff content, entries, undo snapshot,
// session memory).

import { ConfigManager } from '../../utils/ConfigManager.js';
import { evaluateMutation, grantSessionTool, getPermissionMode } from '../harness/MutationGate.js';
import { ToolRegistry } from '../../core/tools/ToolRegistry.js';
import { truncateToolResultForModel, toolResultMaxChars } from '../harness/ToolResultBudget.js';
import { HeldWrites } from '../../utils/file/HeldWrites.js';
import { AgentSession } from '../../utils/agent/AgentSession.js';
import { describeRunning, describeAction } from './AgentDescribe.js';
import { sequentialFileTree } from './AgentFileTreeSequential.js';

const TAG = '[AgentToolExecution]';

const DIFF_PREVIEW_TOOLS = new Set([
  'write', 'create_or_update_file', 'str_replace', 'search_replace_edit', 'edit_file_lines'
]);

async function buildDiffPreview(fc) {
  const path = fc.args?.path;
  if (!path) return { oldContent: '', newContent: fc.args?.content || '' };

  let oldContent = '';
  try {
    const existing = await ToolRegistry.executeTool({ name: 'read', args: { path } });
    if (existing && !existing.error && typeof existing.content === 'string') {
      oldContent = existing.content.replace(/^\d+: /gm, '');
      if (existing.content.includes('\n') && /^\d+: /.test(existing.content.split('\n')[0] || '')) {
        oldContent = existing.content.split('\n').map(l => l.replace(/^\d+: /, '')).join('\n');
      } else {
        oldContent = existing.content;
      }
    }
  } catch (_) {}

  if (fc.name === 'write' || fc.name === 'create_or_update_file') {
    return { oldContent, newContent: fc.args?.content != null ? String(fc.args.content) : '' };
  }

  if (['str_replace', 'search_replace_edit', 'edit_file_lines'].includes(fc.name) && oldContent) {
    try {
      const dry = await ToolRegistry.executeTool({ name: fc.name, args: { ...fc.args, _dryRun: true } });
      if (dry && !dry.error && dry.newContent != null) {
        return { oldContent, newContent: dry.newContent };
      }
    } catch (_) {}
  }

  return { oldContent, newContent: fc.args?.content != null ? String(fc.args.content) : oldContent };
}

export const MUTATING_TOOLS = [
  'write', 'str_replace', 'create_or_update_file', 'search_replace_edit', 'edit_file_lines',
  'create_folder', 'create_file_tree', 'delete_item', 'rename_item', 'move_item', 'copy_file'
];

function getLiveUI(app) {
  return app?.chatHandler?.liveUI || app?.liveUI || null;
}

export async function executeAndLogTool({ app, fc, actionId, safeLogAction, actionsTaken }) {
  const running = describeRunning(fc);
  const mode = getPermissionMode();
  // Pattern allow/deny (.aicodex/permissions.json + settings)
  let patternHit = { decision: null, pattern: null };
  try {
    const { matchPermissionRules } = await import('../harness/PatternPermissions.js');
    patternHit = await matchPermissionRules(fc.name, fc.args || {});
  } catch (_) {}

  let decision = evaluateMutation(app, fc.name, fc.args || {});
  if (patternHit.decision === 'deny') {
    decision = {
      needPrompt: false,
      blocked: true,
      category: decision.category || 'edit',
      reason: `Denied by permission pattern: ${patternHit.pattern}`,
      pattern: patternHit.pattern
    };
  } else if (patternHit.decision === 'allow') {
    decision = {
      needPrompt: false,
      blocked: false,
      category: decision.category || 'edit',
      patternAllow: patternHit.pattern
    };
  }

  let preview = null;
  if (DIFF_PREVIEW_TOOLS.has(fc.name)) {
    try { preview = await buildDiffPreview(fc); } catch (_) {}
  }

  safeLogAction({
    id: actionId,
    verb: running.verb,
    target: running.label,
    status: 'running',
    fullPath: running.fullPath,
    fcName: fc.name,
    fcArgs: fc.args,
    oldContent: preview?.oldContent,
    newContent: preview?.newContent
  });

  let toolResult;

  // Declarative PreToolUse hooks (.aicodex/hooks.json)
  try {
    const { runPreToolUseHooks } = await import('../harness/AgentHooks.js');
    const pre = await runPreToolUseHooks(fc.name, fc.args || {});
    if (pre?.deny) {
      decision = {
        needPrompt: false,
        blocked: true,
        category: decision.category || 'edit',
        reason: pre.reason || 'Blocked by project PreToolUse hook'
      };
    }
  } catch (_) {}

  // Hard block from settings (delete/terminal off)
  if (decision.blocked) {
    toolResult = {
      error: decision.reason || 'Operation blocked by Agent Settings.',
      blocked: true,
      rejected: true
    };
  } else if (fc.name === 'create_file_tree' && decision.needPrompt) {
    toolResult = await sequentialFileTree(app, fc, actionId, safeLogAction, actionsTaken);
  } else if (decision.needPrompt) {
    const liveUI = getLiveUI(app);
    if (liveUI?.askForPermission) {
      liveUI.pauseAgentClock?.();
      let permission = { granted: false };
      try {
        permission = await liveUI.askForPermission(fc, actionId);
      } catch (e) {
        console.warn(TAG, 'askForPermission failed — treating as reject', e);
        permission = { granted: false };
      }
      liveUI.resumeAgentClock?.();
      if (!permission?.granted) {
        toolResult = {
          error: 'System Interception: User rejected this operation.',
          rejected: true,
          oldContent: preview?.oldContent,
          newContent: preview?.newContent
        };
      } else {
        // Session grant for this tool (+ category for edits mode polish)
        grantSessionTool(app, fc.name);
        grantSessionTool(app, `cat:${decision.category}`);
      }
    } else {
      console.warn(TAG, 'No liveUI.askForPermission — blocking mutation mode=', mode);
      toolResult = {
        error: 'System Interception: Write blocked (Accept UI unavailable; set permission mode to full/edits or retry).',
        rejected: true,
        blocked: true,
        oldContent: preview?.oldContent,
        newContent: preview?.newContent
      };
    }
  }

  if (!toolResult) {
    try {
      toolResult = await ToolRegistry.executeTool(fc, app);
      try {
        toolResult = truncateToolResultForModel(toolResult, { maxChars: toolResultMaxChars(app), toolName: fc.name });
      } catch (_) {}
    } catch (e) {
      toolResult = { error: e.message || String(e) };
    }
    if ((fc.name === 'read_file' || fc.name === 'read') && toolResult && !toolResult.error && fc.args?.path) {
      try {
        if (HeldWrites.has(app, fc.args.path)) {
          const disk = toolResult.content != null ? String(toolResult.content) : '';
          toolResult.content = HeldWrites.overlayContent(app, fc.args.path, disk);
          toolResult.heldOverlay = true;
          toolResult.message = (toolResult.message || '') + ' [HELD staged version — already updated in session]';
        }
      } catch (_) {}
    }
  }

  // Record undo snapshot for successful mutating file tools (batched per response)
  try {
    const mutating = new Set([
      'write', 'create_or_update_file', 'str_replace', 'search_replace_edit', 'edit_file_lines',
      'update_project_memory', 'delete_item', 'create_folder',
      'rename_path', 'rename_item', 'move_path', 'move_item', 'copy_path', 'copy_file', 'create_file_tree'
    ]);
    if (mutating.has(fc.name) && toolResult && !toolResult.error && !toolResult.blocked && !toolResult.rejected && !fc.args?._dryRun) {
      const { FileChangeHistory } = await import('../../utils/agent/FileChangeHistory.js');
      const before = toolResult.oldContent != null ? String(toolResult.oldContent)
        : (toolResult._oldContent != null ? String(toolResult._oldContent) : '');
      const after = toolResult.newContent != null ? String(toolResult.newContent)
        : (fc.args?.content != null ? String(fc.args.content) : fc.args?.new_content != null ? String(fc.args.new_content) : '');
      let op = 'edit';
      if (fc.name === 'write' || fc.name === 'create_or_update_file' || fc.name === 'create_file_tree') op = before ? 'edit' : 'create';
      if (fc.name === 'delete_item') op = 'delete';
      if (fc.name === 'create_folder') op = 'create';
      if (fc.name === 'rename_path' || fc.name === 'rename_item') op = 'rename';
      if (fc.name === 'move_path' || fc.name === 'move_item') op = 'move';
      if (fc.name === 'copy_path' || fc.name === 'copy_file') op = 'copy';
      if (fc.name === 'update_project_memory') op = 'memory';
      FileChangeHistory.push(app, {
        path: toolResult.path || toolResult.url || fc.args?.path || fc.args?.to || '',
        before,
        after,
        op,
        fromPath: fc.args?.from || fc.args?.old_path || fc.args?.path || null,
        toPath: fc.args?.to || fc.args?.new_path || toolResult.path || null,
        label: String(fc.args?.path || fc.args?.to || fc.name).split('/').pop() || fc.name
      });
    }
  } catch (_) {}

  // PostToolUse hooks
  try {
    const { runPostToolUseHooks } = await import('../harness/AgentHooks.js');
    await runPostToolUseHooks(fc.name, fc.args || {}, toolResult || {});
  } catch (_) {}

  // Audit trail for mutating tools
  try {
    const mut = new Set([
      'write', 'str_replace', 'edit_file_lines', 'delete_item', 'create_folder',
      'rename_path', 'move_path', 'copy_path', 'update_project_memory', 'run_command', 'run_shell_command'
    ]);
    if (mut.has(fc.name)) {
      const { appendMutationAudit } = await import('../harness/MutationAudit.js');
      await appendMutationAudit({
        tool: fc.name,
        path: fc.args?.path || toolResult?.path || '',
        ok: !(toolResult?.error || toolResult?.rejected),
        dryRun: !!(toolResult?.dryRun),
        chatIndex: app?.currentConversationIndex
      });
    }
  } catch (_) {}

  const finished = describeAction(fc, toolResult);
  finished.fcName = fc.name;

  if (toolResult?.rejected) {
    finished.status = 'rejected';
    finished.verb = 'Rejected';
  }

  if (fc.name === 'run_shell_command' && toolResult?.verified && toolResult?.applied?.length) {
    const okN = toolResult.applied.filter(a => a.success).length;
    if (okN > 0) {
      finished.verb = toolResult.viaFs ? `Wrote ${okN} (FS)` : `Wrote ${okN}`;
      finished.status = 'success';
      finished.label = toolResult.applied.filter(a => a.success).map(a => a.path?.split('/').pop()).filter(Boolean).join(', ') || finished.label;
    }
  }

  if (fc.args) {
    finished.fcArgs = {};
    if (fc.args.command) finished.fcArgs.command = String(fc.args.command).slice(0, 200);
    if (fc.args.path) finished.fcArgs.path = String(fc.args.path).slice(0, 160);
  }

  const uiSilent = !!(toolResult && toolResult._uiSilent);
  if (toolResult?.error) {
    finished.detail = String(toolResult.error).slice(0, 400);
    finished.kind = 'error';
  } else if ((fc.name === 'run_shell_command' || fc.name === 'run_command') && toolResult?.stdout != null) {
    finished.detail = String(toolResult.stdout).slice(0, 500);
    finished.kind = 'command';
  } else if (fc.name === 'grep') {
    const out = toolResult?.output || toolResult?.summary || '';
    finished.kind = 'command';
    finished.detail = String(out).slice(0, 500);
    if (!finished.fcArgs) finished.fcArgs = {};
    const pat = String(fc.args?.pattern || '').slice(0, 80);
    const scope = fc.args?.path ? String(fc.args.path).split('/').pop() : '';
    finished.fcArgs.command = `grep "${pat}"${scope ? ` ${scope}` : ''}`;
    finished.label = finished.fcArgs.command;
    finished.verb = toolResult?.error ? 'Failed' : 'Ran command';
  } else if (fc.name === 'glob') {
    finished.kind = 'command';
    const lines = (toolResult?.matches || []).slice(0, 25).map(m =>
      typeof m === 'string' ? m : (m.path || m.url || m.name || '')
    ).filter(Boolean);
    finished.detail = lines.join('\n').slice(0, 500) || '0 files';
    if (!finished.fcArgs) finished.fcArgs = {};
    finished.fcArgs.command = `find . -name "${String(fc.args?.pattern || '').slice(0, 60)}"`;
    finished.label = finished.fcArgs.command;
    finished.verb = toolResult?.error ? 'Failed' : 'Ran command';
  } else if (fc.name === 'list_directory' && Array.isArray(toolResult?.entries)) {
    finished.kind = 'tree';
    finished.entries = toolResult.entries.slice(0, 60).map(e => ({ name: e.name, isDirectory: !!e.isDirectory }));
  } else if (fc.name === 'list_open_project_folders' && Array.isArray(toolResult?.folders)) {
    finished.kind = 'tree';
    finished.entries = toolResult.folders.slice(0, 20).map(f => ({ name: f.name || 'folder', isDirectory: true }));
  } else if (!uiSilent && toolResult?.hint) {
    finished.detail = String(toolResult.hint).slice(0, 400);
    finished.kind = 'warning';
  }

  if (toolResult?.oldContent != null) finished.oldContent = toolResult.oldContent;
  if (toolResult?.newContent != null) finished.newContent = toolResult.newContent;
  try {
    if (finished.status === 'success' && finished.oldContent != null && (fc.args?.path || finished.url)) {
      const { UndoStore } = await import('../../utils/editor/UndoStore.js');
      UndoStore.push(app, {
        path: fc.args?.path || finished.fullPath || finished.url,
        oldContent: finished.oldContent,
        newContent: finished.newContent,
        url: finished.url || toolResult?.url
      });
    }
  } catch (e) {}

  if (finished.newContent == null && toolResult?.content != null &&
      (fc.name === 'write' || fc.name === 'create_or_update_file' || fc.name === 'update_active_file_content')) {
    finished.newContent = toolResult.content;
    if (finished.oldContent == null) finished.oldContent = toolResult.oldContent != null ? toolResult.oldContent : '';
  }

  if (Array.isArray(toolResult?.applied) && toolResult.applied.length) {
    finished.appliedFiles = toolResult.applied
      .filter(a => a && a.success)
      .map(a => ({
        path: a.path || a.relPath || '',
        oldContent: a.oldContent != null ? a.oldContent : '',
        newContent: a.newContent != null ? a.newContent : (a.content || ''),
        url: a.url || null
      }))
      .filter(a => a.path && a.newContent != null);
  }

  actionsTaken.push(finished);

  try {
    const okWrite = finished.status === 'success' && ['write', 'str_replace', 'create_or_update_file', 'create_file_tree', 'create_folder', 'search_replace_edit', 'edit_file_lines'].includes(fc.name);
    if (okWrite && fc.args?.path) {
      const names = [];
      if (fc.name === 'create_file_tree' && Array.isArray(fc.args.nodes)) {
        const walk = (nodes, prefix = '') => {
          for (const n of nodes) {
            const nm = n.name || n.path || '';
            if (n.type === 'file' || n.content != null) names.push((prefix ? prefix + '/' : '') + nm);
            if (n.children) walk(n.children, (prefix ? prefix + '/' : '') + nm);
          }
        };
        walk(fc.args.nodes);
      } else if (fc.args.path) {
        names.push(String(fc.args.path).split('/').pop());
      }
      AgentSession.noteWrite(app.currentConversationIndex, { path: fc.args.path, fileNames: names });
    }
  } catch (e) {}

  let previewContent = null;
  if ((fc.name === 'read_file' || fc.name === 'read') && toolResult?.content) {
    previewContent = String(toolResult.content).slice(0, 800);
  } else if (fc.name === 'run_shell_command' && toolResult?.stdout != null) {
    previewContent = String(toolResult.stdout).slice(0, 600);
  } else if (toolResult?.error) {
    previewContent = String(toolResult.error).slice(0, 400);
  }

  // Real file length for coverage track scale (not max(read end))
  let fileTotalLines = null;
  try {
    if (toolResult && (toolResult.totalLines != null || toolResult.total_lines != null)) {
      fileTotalLines = Number(toolResult.totalLines ?? toolResult.total_lines) || null;
    }
  } catch (_) {}

  safeLogAction({
    id: actionId,
    verb: finished.verb,
    target: finished.label,
    status: finished.status === 'success' ? 'done'
      : finished.status === 'rejected' ? 'rejected'
      : 'error',
    url: finished.url,
    oldContent: finished.oldContent != null ? finished.oldContent : toolResult?.oldContent,
    newContent: finished.newContent != null ? finished.newContent : toolResult?.newContent,
    previewContent,
    fullPath: finished.fullPath,
    fcName: fc.name,
    fcArgs: fc.args,
    detail: finished.detail,
    kind: finished.kind,
    entries: finished.entries || null,
    fileTotalLines
  });

  return { toolResult, finished };
}
