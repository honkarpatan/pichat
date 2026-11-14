// src/main/agent/main/AgentFinish.js
//
// Turn-completion helpers: finish_task handling + strict constraints.

import { HeldWrites } from '../../utils/file/HeldWrites.js';
import { PLAN_TOOL_NAME, looksLikeFixRequest, settlePlanOnTurnEnd } from './AgentPlanning.js';

const TAG = '[AgentFinish]';

// Added delete, rename, move, copy and folder tools so the loop recognizes them as valid modifications!
const WRITE_TOOLS_ARR = [
  'write', 'str_replace', 'create_or_update_file', 'create_file_tree', 'search_replace_edit', 'edit_file_lines',
  'delete_item', 'rename_item', 'move_item', 'copy_file', 'create_folder'
];

// Added verbs for deletion and renaming
const WRITE_VERBS_RE = /Wrote|Writing|Scaffold|Updated|Patch|Edited|Saved|Created|Held|Deleted|Removed|Renamed|Moved|Copied/i;
const FOLDER_READY_RE = /Folder ready/i;

export function hasRealWrite(actions, app = null) {
  try {
    if (app && HeldWrites.list(app).size > 0) return true;
  } catch (_) {}
  return (actions || []).some(a => {
    if (a.status === 'error' || a.status === 'failed') return false;
    if (WRITE_TOOLS_ARR.includes(a.fcName)) {
      return a.status === 'success' || a.status === 'done';
    }
    return WRITE_VERBS_RE.test(String(a.verb || '')) && !FOLDER_READY_RE.test(String(a.verb || ''));
  });
}

export function hasSuccessfulWriteAction(actions) {
  return hasRealWrite(actions, null);
}

const META_FILE_RE = /(^|\/)(todo|plan|notes?|readme|task)\.md$/i;
const CODE_FILE_RE = /\.(html?|css|js|jsx|ts|tsx|json|vue|svelte|py|java|kt|xml|svg)$/i;

export function hasDeliverableWrite(actions, app = null) {
  try {
    if (app && HeldWrites.list(app).size > 0) return true;
  } catch (_) {}
  return (actions || []).some(a => {
    if (a.status === 'error' || a.status === 'failed') return false;
    if (!WRITE_TOOLS_ARR.includes(a.fcName) && !WRITE_VERBS_RE.test(String(a.verb || ''))) return false;
    if (!(a.status === 'success' || a.status === 'done' || !a.status)) return false;
    const path = String(a.fullPath || a.url || a.label || a.target || a.fcArgs?.path || '');
    const base = path.split('/').pop() || path;
    if (META_FILE_RE.test(base) || META_FILE_RE.test(path)) return false;
    const body = String(a.newContent || '');
    if (body) {
      const low = body.toLowerCase();
      if ((/welcome to acode|successfully initialized|workspace is ready|ready for development/.test(low))
          && body.length < 3500
          && !/blog|article|newsletter|sidebar/.test(low)) {
        return false;
      }
    }
    // For delete_item, newContent is empty, so it safely reaches here and returns true.
    return true;
  });
}

export async function finalizeLiveUI(app, actionsTaken = [], planState = null) {
  try {
    const { FileChangeHistory } = await import('../../utils/agent/FileChangeHistory.js');
    FileChangeHistory.endBatch(app);
  } catch (_) {}
  try {
    if (planState) settlePlanOnTurnEnd(app, planState);
  } catch (_) {}
  try {
    if (app.chatHandler?.liveUI?.finalizeAgentLog) {
      app.chatHandler.liveUI.finalizeAgentLog();
    }
  } catch (_) {}
  // Clear any leftover status ("Running canvas preview…") before async preview
  try {
    app.chatHandler?.liveUI?.updateAssistantMessage?.(false, '', 0);
  } catch (_) {}
  try {
    const acts = actionsTaken || [];
    if (acts.length) {
      import('../../core/canvas/CanvasPostAgent.js')
        .then((m) => m.CanvasPostAgent.afterAgentTurn(app, acts))
        .catch((e) => console.warn(TAG, 'CanvasPostAgent', e));
    }
  } catch (e) {
    console.warn(TAG, 'canvas post-hook', e);
  }
}

const FINISH_WRITE_VERBS = /Wrote|Writing|Scaffold|Updated|Patch|Edited|Deleted|Removed|Renamed|Moved|Copied/i;
const FINISH_WRITE_TOOLS = new Set([
  'write', 'str_replace',
  'create_or_update_file', 'create_file_tree', 'search_replace_edit',
  'edit_file_lines', 'update_active_file_content',
  'delete_item', 'rename_item', 'move_item', 'copy_file', 'create_folder'
]);

const EXPLORE_ONLY_TOOLS = new Set([
  'read', 'read_file', 'list_directory', 'glob', 'grep', 'subagent',
  'tool_search', 'fetch_content', 'web_search', 'answer_informational_query',
  'todo_write', 'finish_task', 'ask_user_question', 'check_exists',
  'list_open_project_folders', 'preview_html', 'load_skill'
]);

export function isExploreOnlyTurn(actionsTaken, userText = '') {
  const acts = actionsTaken || [];
  if (acts.length === 0) return false;
  const onlyExplore = acts.every(a => EXPLORE_ONLY_TOOLS.has(a.fcName) || !a.fcName);
  if (!onlyExplore) return false;
  const u = String(userText || '');
  // If user clearly asked to create/fix/write, not explore-only
  if (/\b(creat|fix|implement|write|edit|refactor|delete|rename)\w*/i.test(u) &&
      !/\b(explore|summar|list|what (is|are)|explain|how does|read)\w*/i.test(u)) {
    return false;
  }
  return true;
}

export function handleFinishCall({ finishCall, actionsTaken, workingMessages, safeLogAction, counters, step, planState, isFastDebug: isFastDebugFlag = false, isReadOnly = false, userText = '' }) {
  
  // Explore / list / summarize turns — allow finish without writes
  if (isReadOnly || isExploreOnlyTurn(actionsTaken, userText)) {
      let summary = (finishCall.args && finishCall.args.summary) ? String(finishCall.args.summary).trim() : '';
      return { finished: true, summary };
  }

  const hasRealWriteForFinish = actionsTaken.some(a => {
    if (a.status === 'error' || a.status === 'failed') return false;
    if (FINISH_WRITE_TOOLS.has(a.fcName) && (a.status === 'success' || a.status === 'done' || !a.status)) return true;
    if (FINISH_WRITE_VERBS.test(String(a.verb || ''))) return true;
    if (a.fcName === 'run_shell_command' || a.fcName === 'run_command') {
      const cmd = String((a.fcArgs && a.fcArgs.command) || a.detail || '');
      return /(?:cat|tee)\s*>|<<\s*['"]?EOF|sed\s+-i|echo\s+.*>/i.test(cmd);
    }
    return false;
  });
  
  const onlyMeta = actionsTaken.length > 0 && actionsTaken.every(a =>
    ['list_open_project_folders', 'list_directory', 'create_folder', 'finish_task',
     'list_terminals', 'detect_package_manager', 'read', 'glob', 'grep', PLAN_TOOL_NAME].includes(a.fcName)
  );

  const planOpen = planState?.hasPlan && !planState?.allDone;
  const isFastDebug = !!isFastDebugFlag;

  if (!hasRealWriteForFinish || onlyMeta || (planOpen && !isFastDebug)) {
    counters.autoCorrectCount++;
    if (counters.autoCorrectCount <= 4) {
      // System-only nudge — do not pollute work log with "Nudge / Missing Fix"
      try {
        console.warn(TAG, 'finish_task blocked',
          planOpen ? 'plan open' : (isFastDebug ? 'missing fix' : 'no write yet'));
      } catch (_) {}
      
      let systemAlert = `[SYSTEM: finish_task REJECTED. `;
      
      if (planOpen && !isFastDebug) {
        const pendingItems = (planState.items || [])
          .filter(i => i.status !== 'done')
          .map((i, idx) => `${idx + 1}. "${i.text || i.task}"`)
          .join('\n');
        const nextOne = (planState.items || []).find(i => i.status !== 'done');
        systemAlert += `Your plan is NOT complete!\nPending:\n${pendingItems}\nNEXT REQUIRED: "${nextOne?.text || nextOne?.task || ''}". Implement this step with tools NOW. Do not skip steps.]`;
      } else if (isFastDebug) {
        systemAlert += `You haven't applied any fixes! You MUST use 'str_replace' or 'edit_file_lines' to actually fix the error in the file before calling finish_task.]`;
      } else {
        const readFiles = (actionsTaken || [])
          .filter(a => (a.fcName === 'read' || a.fcName === 'read_file') && a.status !== 'error')
          .map(a => String(a.fullPath || a.url || a.label || a.fcArgs?.path || '').split('/').pop())
          .filter(Boolean);
        const readHint = readFiles.length
          ? ` You already read: ${[...new Set(readFiles)].join(', ')} — do NOT re-read them, call str_replace or write on them directly now.`
          : '';
        systemAlert += `You only listed folders or created empty directories. The user asked for a working app/files. You MUST modify the project now using 'write', 'str_replace', 'delete_item', etc.${readHint} Do NOT call finish_task until the action is completed.]`;
      }

      console.warn(TAG, 'Blocked premature finish_task —', planOpen ? 'Plan open' : 'No content written');
      workingMessages.push({ role: 'user', content: [{ text: systemAlert }] });
      return { blocked: true };
    }
  }

  let summary = (finishCall.args && finishCall.args.summary) ? String(finishCall.args.summary).trim() : '';
  const sellsNewBuild = summary && (
    /\bcreated a fully[- ]?featured\b/i.test(summary)
    || /\bbuilt a (complete|fully)\b/i.test(summary)
    || /\b(created|built|developed)\b[\s\S]{0,80}\b(fully[- ]?featured|from scratch|brand new)\b/i.test(summary)
    || /\b(created|built)\b[\s\S]{0,80}\b(snake game|in HTML|, CSS, and JS)\b/i.test(summary)
  );
  const wasUpdate = (actionsTaken || []).some(a =>
    a && (a.status === 'success' || a.status === 'done') &&
    a.oldContent != null && String(a.oldContent).length > 40
  );
  if (summary) {
    if (isFastDebug && (sellsNewBuild || (summary.length > 120 && !/\b(fix|fixed|patch|updated|corrected|resolved)\b/i.test(summary)))) {
      console.warn(TAG, 'Rewrote marketing finish summary for fix turn');
      summary = 'Applied a targeted fix to the existing project.';
    } else if (wasUpdate && sellsNewBuild) {
      console.warn(TAG, 'Rewrote marketing finish summary for update turn');
      summary = 'Updated the existing project with the requested changes.';
    }
  }
  return { finished: true, summary };
}
