// src/main/agent/main/AgentDescribe.js
//
// Pure data helpers: turn a tool call (+ its result) into the small
// {verb,label,status,url,...} shape the rest of the pipeline (safeLogAction
// → LiveChatUI.logAgentAction → MessagePart) understands. No DOM, no icons —
// the OpenCode-exact UI shows a single status checkbox per step
// (done/error/running), not a per-tool icon, so icon lookups were dropped
// entirely instead of kept as dead weight.

export function describeRunning(fc) {
  const shortName = (p) => (typeof p === 'string' && p.length) ? p.split('/').pop() : '';
  const args = fc.args || {};
  const fullPath = args.path || args.sourcePath || '';

  const RUNNING = {
    write: { verb: 'Writing', target: shortName(args.path) },
    create_or_update_file: { verb: 'Writing', target: shortName(args.path) },
    str_replace: { verb: 'Patching', target: shortName(args.path) },
    search_replace_edit: { verb: 'Patching', target: shortName(args.path) },
    read: { verb: 'Reading', target: shortName(args.path) },
    grep: {
      verb: 'Ran command',
      target: args.pattern
        ? `grep "${String(args.pattern).slice(0, 80)}"${args.path ? ` ${String(args.path).split('/').pop()}` : ''}`
        : 'grep'
    },
    glob: {
      verb: 'Ran command',
      target: args.pattern ? `find . -name "${String(args.pattern).slice(0, 60)}"` : 'find'
    },
    run_command: { verb: 'Running', target: String(args.command || '').slice(0, 40) },
    edit_file_lines: { verb: 'Editing', target: shortName(args.path) },
    create_folder: { verb: 'Creating folder', target: shortName(args.path) },
    create_file_tree: { verb: 'Scaffolding', target: shortName(args.path) },
    delete_item: { verb: 'Deleting', target: shortName(args.path) },
    rename_item: { verb: 'Renaming', target: shortName(args.path) },
    move_item: { verb: 'Moving', target: shortName(args.sourcePath) },
    copy_file: { verb: 'Copying', target: shortName(args.sourcePath) },
    read_file: { verb: 'Reading', target: shortName(args.path) },
    list_directory: { verb: '', target: shortName(args.path) },
    list_open_project_folders: { verb: '', target: '' },
    open_project_folder: { verb: 'Opening', target: shortName(args.path) },
    close_project_folder: { verb: 'Closing', target: shortName(args.path) },
    reload_project_folder: { verb: 'Reloading', target: shortName(args.path) },
    find_project_folder: { verb: 'Finding', target: shortName(args.path) },
    check_exists: { verb: 'Checking', target: args.name },
    run_shell_command: { verb: 'Running', target: args.command },
    open_terminal: { verb: 'Opening terminal', target: args.command || 'Agent Terminal' },
    detect_package_manager: { verb: 'Detecting package manager', target: '' },
    write_to_terminal: { verb: 'Sending to terminal', target: '' },
    list_terminals: { verb: 'Listing terminals', target: '' },
    close_terminal: { verb: 'Closing terminal', target: '' },
    get_active_file_content: { verb: 'Reading active file', target: '' },
    get_open_tabs: { verb: 'Checking open tabs', target: '' },
    update_active_file_content: { verb: 'Updating active file', target: '' },
    web_search: { verb: 'Searching web for', target: String(args.query || '').slice(0, 72) },
    fetch_content: { verb: 'Fetching', target: String(args.url || '').slice(0, 72) },
    apply_patch: { verb: 'Applying patch', target: 'diff' },
    multi_edit: { verb: 'Multi-editing', target: (typeof args.path === 'string' && args.path.split('/').pop()) || '' },
    get_diagnostics: { verb: 'Checking', target: (typeof args.path === 'string' && args.path.split('/').pop()) || '' },
    git_status: { verb: 'Git status', target: '' },
    git_diff: { verb: 'Git diff', target: args.path || '' },
    git_log: { verb: 'Git log', target: '' },
    fetch_educational_images: { verb: 'Fetching images for', target: args.topic },
    todo_write: { verb: 'Updating plan', target: '' },
    finish_task: { verb: 'Wrapping up', target: '' }
  };
  const info = RUNNING[fc.name] || { verb: 'Running', target: fc.name };
  return { verb: info.verb, label: (info.target || '').trim(), fullPath };
}

export function describeAction(fc, toolResult) {
  const shortName = (p) => (typeof p === 'string' && p.length) ? p.split('/').pop() : '';
  const ok = !!(toolResult && toolResult.error === undefined && toolResult.success !== false);
  const status = ok ? 'success' : 'error';
  const args = fc.args || {};
  const fullPath = args.path || args.sourcePath || '';

  let resultObj;
  switch (fc.name) {
    case 'write':
    case 'create_or_update_file': resultObj = { label: shortName(args.path) || 'file', verb: ok ? (toolResult?.message?.includes('updated') ? 'Updated' : 'Created') : 'Failed', status, url: toolResult?.url }; break;
    case 'str_replace':
    case 'search_replace_edit': resultObj = { label: shortName(args.path) || 'file', verb: ok ? 'Updated' : 'Failed', status, url: toolResult?.url }; break;
    case 'edit_file_lines': resultObj = { label: shortName(args.path) || 'file', verb: ok ? `+${toolResult?.added ?? 0} -${toolResult?.removed ?? 0}` : 'Failed', status, url: toolResult?.url }; break;
    case 'create_folder': resultObj = { label: (shortName(args.path) || 'folder') + '/', verb: ok ? 'Folder ready' : 'Failed', status }; break;
    case 'create_file_tree': resultObj = { label: (shortName(args.path) || 'folder') + '/', verb: ok ? `Scaffolded ${toolResult?.created ?? ''} item(s)`.trim() : 'Failed', status }; break;
    case 'delete_item': resultObj = { label: shortName(args.path) || 'item', verb: ok ? 'Deleted' : 'Failed', status }; break;
    case 'rename_item': resultObj = { label: shortName(args.path) || 'item', verb: ok ? `Renamed to "${args.newName}"` : 'Failed', status }; break;
    case 'move_item': resultObj = { label: shortName(args.sourcePath) || 'item', verb: ok ? 'Moved' : 'Failed', status }; break;
    case 'copy_file': resultObj = { label: shortName(args.sourcePath) || 'file', verb: ok ? 'Copied' : 'Failed', status }; break;
    case 'read':
    case 'read_file': resultObj = { label: shortName(args.path) || 'file', verb: ok ? 'Read' : 'Failed', status }; break;
    case 'grep': {
      const pat = String(args.pattern || '').slice(0, 80);
      const scope = shortName(args.path) || '.';
      const n = toolResult?.matchCount ?? (Array.isArray(toolResult?.matches) ? toolResult.matches.length : null);
      const cmd = `grep "${pat}"${args.path ? ` ${scope}` : ''}`;
      resultObj = {
        label: cmd,
        verb: ok ? 'Ran command' : 'Failed',
        status,
        kind: 'command',
        detail: String(toolResult?.output || toolResult?.summary || (n != null ? `${n} match(es)` : '')).slice(0, 500)
      };
      break;
    }
    case 'glob': {
      const pat = String(args.pattern || '').slice(0, 60);
      const cmd = `find . -name "${pat}"`;
      const n = Array.isArray(toolResult?.matches) ? toolResult.matches.length : 0;
      resultObj = {
        label: cmd,
        verb: ok ? 'Ran command' : 'Failed',
        status,
        kind: 'command',
        detail: String((toolResult?.matches || []).slice(0, 20).map(m => typeof m === 'string' ? m : (m.path || m.name || '')).join('\n') || `${n} file(s)`).slice(0, 500)
      };
      break;
    }
    case 'list_directory': resultObj = { label: (shortName(args.path) || 'folder') + '/', verb: ok ? '' : 'Failed', status, entries: toolResult?.entries }; break;
    case 'list_open_project_folders': resultObj = { label: '', verb: ok ? '' : 'Failed', status, entries: toolResult?.folders?.map(f => ({ name: f.name, isDirectory: true })) }; break;
    case 'open_project_folder': resultObj = { label: shortName(args.path) || 'folder', verb: ok ? 'Opened' : 'Failed', status }; break;
    case 'close_project_folder': resultObj = { label: shortName(args.path) || 'folder', verb: ok ? 'Closed' : 'Failed', status }; break;
    case 'reload_project_folder': resultObj = { label: shortName(args.path) || 'folder', verb: ok ? 'Reloaded' : 'Failed', status }; break;
    case 'find_project_folder': resultObj = { label: shortName(args.path) || 'path', verb: ok ? (toolResult?.found ? 'Found' : 'Not found') : 'Failed', status }; break;
    case 'check_exists': resultObj = { label: args.name || 'item', verb: ok ? 'Checked' : 'Failed', status }; break;
    case 'run_command':
    case 'run_shell_command': resultObj = { label: args.command || 'command', verb: ok ? 'Ran' : 'Failed', status: (toolResult && toolResult.success === false) ? 'error' : status }; break;
    case 'open_terminal': resultObj = { label: args.command || 'Agent Terminal', verb: ok ? 'Opened' : 'Failed', status }; break;
    case 'detect_package_manager': resultObj = { label: toolResult?.packageManager || 'pkg', verb: ok ? (toolResult?.cached ? 'Cached' : 'Detected') : 'Failed', status }; break;
    case 'write_to_terminal': resultObj = { label: 'Terminal input', verb: ok ? 'Sent' : 'Failed', status }; break;
    case 'list_terminals': resultObj = { label: 'Terminals', verb: ok ? 'Listed' : 'Failed', status }; break;
    case 'close_terminal': resultObj = { label: 'Terminal', verb: ok ? 'Closed' : 'Failed', status }; break;
    case 'get_active_file_content': resultObj = { label: toolResult?.filename || 'Active File', verb: ok ? 'Read' : 'Failed', status }; break;
    case 'get_open_tabs': resultObj = { label: 'Open Tabs', verb: ok ? 'Checked' : 'Failed', status }; break;
    case 'update_active_file_content': resultObj = { label: 'Active File', verb: ok ? 'Updated' : 'Failed', status }; break;
    case 'web_search': {
      const q = String(args.query || toolResult?.query || toolResult?.result?.query || '').slice(0, 72);
      resultObj = {
        label: q || 'web',
        verb: ok ? 'Searched web for' : 'Search failed',
        status,
        kind: 'web',
        detail: ok
          ? String(
              (toolResult?.result?.items || toolResult?.items || [])
                .slice(0, 5)
                .map(it => (it.title || it.url || '') + (it.url ? ` — ${it.url}` : ''))
                .filter(Boolean)
                .join('\n') || toolResult?.result?.text || ''
            ).slice(0, 600)
          : String(toolResult?.error || '')
      };
      break;
    }
    case 'fetch_content': {
      const u = String(args.url || toolResult?.url || '').slice(0, 80);
      resultObj = {
        label: u || 'url',
        verb: ok ? 'Fetched' : 'Fetch failed',
        status,
        kind: 'web'
      };
      break;
    }
    case 'fetch_educational_images': resultObj = { label: args.topic || 'Images', verb: ok ? 'Fetched' : 'Failed', status }; break;
    case 'todo_write': resultObj = { label: '', verb: ok ? 'Plan updated' : 'Failed', status }; break;
    case 'finish_task': resultObj = { label: '', verb: ok ? 'Finished' : 'Failed', status }; break;
    case 'preview_html': resultObj = { label: shortName(args.path) || 'HTML', verb: ok ? (toolResult?.errors?.length ? `Preview · ${toolResult.errors.length} err` : 'Previewed') : 'Preview failed', status: toolResult?.errors?.length ? 'error' : status, url: toolResult?.path }; break;
    case 'apply_patch':
      resultObj = {
        label: (toolResult?.files || []).join(', ') || 'patch',
        verb: ok ? (toolResult?.dryRun ? 'Patch dry-run' : 'Applied patch') : 'Patch failed',
        status
      };
      break;
    case 'multi_edit':
      resultObj = {
        label: shortName(args.path) || 'file',
        verb: ok ? `Multi-edit ×${toolResult?.editsApplied || ''}` : 'Multi-edit failed',
        status
      };
      break;
    case 'get_diagnostics':
      resultObj = {
        label: shortName(args.path) || 'file',
        verb: ok ? (toolResult?.clean ? 'Clean' : 'Diagnostics') : 'Check failed',
        status
      };
      break;
    default: resultObj = { label: fc.name, verb: ok ? 'Done' : 'Failed', status }; break;
  }
  resultObj.fullPath = fullPath;
  return resultObj;
}