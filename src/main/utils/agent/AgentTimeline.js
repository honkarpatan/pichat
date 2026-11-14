/**
 * AgentTimeline — structured side-channel for agent UI.
 * STRICT serial order: same sequence as live logAgentAction / tool steps.
 */

const MAX_PREVIEW = 4000;
const MAX_FILE_CONTENT = 500000;
const MAX_ARGS_STR = 200;
const MAX_HISTORY_ACTIONS = 120;

function isFileWriteAction(a) {
  const fc = a.fcName || '';
  if (fc === 'create_or_update_file' || fc === 'search_replace_edit' ||
      fc === 'edit_file_lines' || fc === 'update_active_file_content' ||
      fc === 'create_file_tree') return true;
  if (Array.isArray(a.appliedFiles) && a.appliedFiles.length) return true;
  return /^(Saved|Save failed|Writing|Wrote|Updated|Patch|Edited|Scaffold)/i.test(String(a.verb || ''));
}

function isInternal(a) {
  return /^(Nudge|Pipeline|Codegen|Tools|Force|Re-?init|Emit|Intercept)/i.test(String(a.verb || ''));
}

function isWeb(a) {
  return a.kind === 'web' || a.fcName === 'web_search' || /^(Searching|Searched)/i.test(String(a.verb || ''));
}

export class AgentTimeline {
  static compactActions(actions) {
    if (!Array.isArray(actions)) return [];
    const out = [];
    let keptWeb = false;

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i] || {};
      if (isInternal(a)) continue;

      if (isWeb(a)) {
        if (keptWeb) {
          const prevIdx = out.findIndex(isWeb);
          if (prevIdx >= 0) {
            const prev = out[prevIdx];
            const prevN = Array.isArray(prev.entries) ? prev.entries.length : 0;
            const nextN = Array.isArray(a.entries) ? a.entries.length : 0;
            if (nextN > prevN) out[prevIdx] = AgentTimeline._rowFromAction(a);
          }
          continue;
        }
        keptWeb = true;
      }

      if (out.length && String(a.verb || '') === 'Read') {
        const prev = out[out.length - 1];
        const lab = a.label || a.target || '';
        if (prev.verb === 'Read' && (prev.label || prev.target) === lab) continue;
      }

      out.push(AgentTimeline._rowFromAction(a));
      if (out.length >= MAX_HISTORY_ACTIONS) break;
    }
    return out;
  }

  static _rowFromAction(a) {
    const row = {
      verb: a.verb || '',
      label: a.label || a.target || '',
      target: a.target || a.label || '',
      status: a.status || 'success',
      fullPath: a.fullPath || '',
      fcName: a.fcName || '',
      url: a.url || undefined
    };
    if (a.kind) row.kind = a.kind;
    if (a.path) row.path = a.path;

    if (isFileWriteAction(a)) {
      if (a.newContent != null || a.oldContent != null || a.content != null) {
        row.oldContent = String(a.oldContent != null ? a.oldContent : '').slice(0, MAX_FILE_CONTENT);
        row.newContent = String(
          a.newContent != null ? a.newContent : (a.content != null ? a.content : '')
        ).slice(0, MAX_FILE_CONTENT);
      }
      if (Array.isArray(a.appliedFiles) && a.appliedFiles.length) {
        row.appliedFiles = a.appliedFiles.slice(0, 30).map(f => ({
          path: f.path || '',
          url: f.url || undefined,
          oldContent: String(f.oldContent != null ? f.oldContent : '').slice(0, MAX_FILE_CONTENT),
          newContent: String(f.newContent != null ? f.newContent : (f.content || '')).slice(0, MAX_FILE_CONTENT)
        }));
      }
    } else {
      if (a.oldContent) row.oldContent = String(a.oldContent).slice(0, MAX_PREVIEW);
      if (a.newContent) row.newContent = String(a.newContent).slice(0, MAX_PREVIEW);
    }

    if (a.detail && a.kind !== 'info') row.detail = String(a.detail).slice(0, MAX_PREVIEW);

    if (Array.isArray(a.entries) && a.entries.length) {
      row.entries = a.entries.slice(0, 40).map(e => {
        const item = {
          name: e.name || e.title || e.url || '',
          isDirectory: !!e.isDirectory
        };
        if (e.url || e.type === 'link') {
          item.url = String(e.url || '').slice(0, 500);
          item.type = 'link';
        }
        return item;
      });
    }

    if (a.fcArgs && typeof a.fcArgs === 'object') {
      const slim = {};
      if (a.fcArgs.command) slim.command = String(a.fcArgs.command).slice(0, MAX_ARGS_STR);
      if (a.fcArgs.path) slim.path = String(a.fcArgs.path).slice(0, 120);
      if (Object.keys(slim).length) row.fcArgs = slim;
    }
    return row;
  }

  static detailFromResult(fcName, args, toolResult) {
    if (!toolResult) return null;
    if (toolResult.error) {
      return { kind: 'error', text: String(toolResult.error).slice(0, MAX_PREVIEW) };
    }
    if (fcName === 'run_shell_command') {
      const cmd = args?.command ? String(args.command).slice(0, MAX_ARGS_STR) : '';
      const out = toolResult.stdout != null ? String(toolResult.stdout).slice(0, MAX_PREVIEW) : '';
      return { kind: 'command', command: cmd, text: out };
    }
    if (fcName === 'read_file' && toolResult.content) {
      return { kind: 'info', text: String(toolResult.content).slice(0, MAX_PREVIEW) };
    }
    return null;
  }
}
