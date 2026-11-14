// src/main/agent/main/AgentFileTreeSequential.js
//
// Flattens a create_file_tree call into individual create_or_update_file
// writes, confirming ONE file at a time (Accept → write → next) instead of
// silently dumping the whole tree to disk. Each file gets a proper diff
// card (oldContent/newContent passed through) — an intentional improvement
// over the pre-refactor version, which only logged plain "Created x" rows
// for tree-scaffolded files with no diff.

import { ToolRegistry } from '../../core/tools/ToolRegistry.js';
import { describeAction } from './AgentDescribe.js';

export async function sequentialFileTree(app, fc, actionId, safeLogAction, actionsTaken) {
  const root = fc.args?.path || '';
  const nodes = fc.args?.nodes || [];
  const files = [];

  const walk = (list, prefix) => {
    for (const n of list || []) {
      if (!n) continue;
      if (n.type === 'file' || (n.content != null && n.name)) {
        const rel = [prefix, n.name].filter(Boolean).join('/');
        files.push({ name: n.name, rel, content: String(n.content ?? '') });
      } else if (n.type === 'directory' || n.children) {
        walk(n.children || [], [prefix, n.name].filter(Boolean).join('/'));
      }
    }
  };
  walk(nodes, '');

  if (!files.length) {
    return { success: false, created: 0, error: 'No file nodes in create_file_tree' };
  }

  let created = 0;
  const applied = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = root
      ? (root.endsWith('/') ? root + f.rel : root + '/' + f.rel)
      : f.rel;
    const subFc = {
      id: `${actionId || 'tree'}-${i}`,
      name: 'create_or_update_file',
      args: { path, content: f.content }
    };

    safeLogAction?.({
      id: subFc.id,
      verb: 'Writing',
      target: f.rel || f.name,
      status: 'running',
      fcName: 'create_or_update_file',
      fcArgs: { path }
    });

    let existingOld = '';
    try {
      const existing = await ToolRegistry.executeTool({ name: 'read', args: { path } });
      if (existing && !existing.error && typeof existing.content === 'string') {
        existingOld = existing.content.replace(/^\d+: /gm, '');
      }
    } catch (_) {}

    let granted = true;
    if (app.chatHandler?.liveUI?.askForPermission) {
      app.chatHandler.liveUI.pauseAgentClock?.();
      try {
        if (app.chatHandler.liveUI.updateAssistantMessage) {
          app.chatHandler.liveUI.updateAssistantMessage(
            true,
            `File ${i + 1}/${files.length}: ${f.rel || f.name} — Accept or Reject`,
            120000
          );
        }
        const permission = await app.chatHandler.liveUI.askForPermission(
          { ...subFc, oldContent: existingOld, newContent: f.content },
          subFc.id
        );
        granted = !!permission?.granted;
      } finally {
        app.chatHandler.liveUI.resumeAgentClock?.();
      }
    }

    if (!granted) {
      safeLogAction?.({
        id: subFc.id,
        verb: 'Rejected',
        target: f.rel || f.name,
        status: 'error',
        fcName: 'create_or_update_file'
      });
      applied.push({ path, success: false, rejected: true });
      continue;
    }

    let toolResult;
    try {
      toolResult = await ToolRegistry.executeTool(subFc);
    } catch (e) {
      toolResult = { error: e.message || String(e), success: false };
    }
    const ok = toolResult && toolResult.success !== false && !toolResult.error;
    if (ok) created++;
    applied.push({ path, success: ok, error: toolResult?.error });

    const finished = describeAction(subFc, toolResult);
    finished.fcName = 'create_or_update_file';
    if (toolResult?.oldContent != null) finished.oldContent = toolResult.oldContent;
    if (toolResult?.newContent != null) finished.newContent = toolResult.newContent;
    else if (ok) finished.newContent = f.content;
    actionsTaken.push(finished);

    safeLogAction?.({
      id: subFc.id,
      verb: finished.verb,
      target: finished.label,
      status: ok ? 'done' : 'error',
      fcName: 'create_or_update_file',
      detail: toolResult?.error || null,
      oldContent: finished.oldContent,
      newContent: finished.newContent
    });
  }

  return {
    success: created > 0,
    created,
    message: `Created ${created}/${files.length} file(s) (sequential confirm)`,
    applied
  };
}