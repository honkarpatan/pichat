// src/main/utils/agent/AgentDualPipeline.js
/**
 * AgentDualPipeline — two-response agent architecture:
 *  1) TOOL phase: read/list/find (system runs tools, builds context)
 *  2) CODE phase: model generates advanced path-tagged source (no tools)
 *  3) APPLY phase: FileBlockApplier create/update + replace blocks
 *
 * Matches normal-chat quality generation while tools handle FS.
 *
 * 🟢 CHANGES IN THIS VERSION:
 *  - isDualAiEnabled(): new config-gated toggle. Config key `agentDualAiEnabled`,
 *    DEFAULT OFF. When off, runDualPipeline() no-ops immediately (handled:false)
 *    so the caller falls back to the normal tool/lazy-write path — nothing about
 *    the dual system runs unless the user explicitly turns it on in settings.
 *  - generateAndApply() no longer silently buffers the ENTIRE hidden response
 *    before showing anything. It now feeds every chunk through a
 *    StreamFileCollector (same one normal agent-mode streaming uses) so live
 *    "Writing…" diff cards appear AS the hidden advanced generation happens —
 *    not only once the whole thing is done. The actual disk write is still
 *    gated behind requestApplyMarkdown (Apply / Apply all) — confirmation
 *    before writing is unchanged.
 */

import { ToolRegistry } from '../../core/tools/ToolRegistry.js';
import { AgentSession } from './AgentSession.js';
import { getProjectFolder } from '../file/fileOperations.js';
import { parseFileBlocks, applyFileBlocks, resolveProjectPath } from '../file/FileBlockApplier.js';
import { requestApplyMarkdown, upsertLiveFileCard } from '../file/PendingWriteGate.js';
import { StreamFileCollector } from '../file/StreamFileCollector.js';
import { ConfigManager } from '../ConfigManager.js';

const TAG = '[AgentDualPipeline]';

/**
 * 🟢 Dual-AI master switch. Default OFF — must be explicitly turned on
 * (Agent Settings → e.g. a "Dual AI (advanced codegen)" checkbox writing to
 * ConfigManager key 'agentDualAiEnabled'). Mirrors the null-is-off pattern
 * (unlike agentAllowTerminal/agentAllowDelete, which default to true).
 */
export function isDualAiEnabled() {
  try {
    const v = ConfigManager.get('agentDualAiEnabled');
    return v === true || v === 'true';
  } catch (_) {
    return false;
  }
}

/** ```replace file="path" ... @@@OLD ... @@@NEW ... ``` */
export function parseReplaceBlocks(markdown) {
  if (!markdown) return [];
  const text = String(markdown).replace(/\r\n/g, '\n');
  const out = [];
  const re = /```replace[ \t]+(?:file\s*=\s*["']([^"']+)["']|([^\s`]+))[ \t]*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const path = (m[1] || m[2] || '').trim();
    const body = m[3] || '';
    const oldM = body.match(/@@@OLD\s*\n([\s\S]*?)\n@@@NEW\s*\n([\s\S]*?)$/i)
      || body.match(/<<<<<<<\s*OLD\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>>\s*NEW/i);
    if (!path || !oldM) continue;
    const oldText = oldM[1];
    const newText = oldM[2];
    if (!oldText?.trim()) continue;
    out.push({ path, oldText, newText });
  }
  return out;
}

async function runTool(name, args = {}) {
  try {
    return await ToolRegistry.executeTool({ name, args, id: `dual-${name}` });
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

/**
 * Phase 1 — gather project + working-dir context via tools (no model).
 */
export async function gatherToolContext(app, onAction) {
  const conversationId = app.currentConversationIndex;
  const session = AgentSession.load(conversationId) || {};
  const parts = [];
  const actions = [];

  const log = (verb, target, status = 'done', extra = {}) => {
    const row = { id: `dual-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, verb, target, status, ...extra };
    actions.push(row);
    onAction?.(row);
  };

  const foldersRes = await runTool('list_open_project_folders', {});
  log('Checked', 'project folders', foldersRes?.success !== false ? 'done' : 'error');
  if (foldersRes?.folders?.length) {
    parts.push('[Open projects]\n' + foldersRes.folders.map(f => `- ${f.name}: ${f.url || f.uri || ''}`).join('\n'));
  }

  const project = await getProjectFolder().catch(() => null);
  if (project?.name) {
    AgentSession.save(conversationId, { projectName: project.name, projectUri: project.uri });
  }

  let workDir = session.workingDir || '';
  // Heuristic from last user message later; for now session only
  let listPath = null;
  if (project?.uri && workDir) {
    listPath = `${project.uri.replace(/\/$/, '')}/${workDir}`;
  } else if (foldersRes?.folders?.[0]?.url || foldersRes?.folders?.[0]?.uri) {
    listPath = foldersRes.folders[0].url || foldersRes.folders[0].uri;
  }

  if (listPath) {
    const listRes = await runTool('list_directory', { path: listPath });
    log('Listed', workDir || 'project root', listRes?.success !== false ? 'done' : 'error');
    if (listRes?.entries?.length) {
      parts.push(`[Directory ${workDir || 'root'}]\n` + listRes.entries.slice(0, 40).map(e =>
        `${e.isDirectory ? '📁' : '📄'} ${e.name}`
      ).join('\n'));
    }

    // Read up to 4 source files for edit context (size-capped)
    const files = (listRes?.entries || []).filter(e => !e.isDirectory && /\.(html?|css|js|ts|jsx|tsx|json|md)$/i.test(e.name)).slice(0, 4);
    for (const f of files) {
      const filePath = `${listPath.replace(/\/$/, '')}/${f.name}`;
      const readRes = await runTool('read_file', { path: filePath });
      log('Read', f.name, readRes?.content != null ? 'done' : 'error');
      if (readRes?.content != null) {
        const body = String(readRes.content).slice(0, 12000);
        parts.push(`[File ${workDir ? workDir + '/' : ''}${f.name}]\n\`\`\`\n${body}\n\`\`\``);
      }
    }
  }

  parts.push(AgentSession.toPromptBlock(conversationId));
  return { context: parts.join('\n\n'), actions, workDir, project };
}

/**
 * Phase 2+3 — model generates path-tagged / replace blocks; system applies.
 * 🟢 Now streams live diff cards via StreamFileCollector as chunks arrive,
 * instead of only showing anything once the whole response is buffered.
 */
export async function generateAndApply(app, config, apiMessages, toolContext, onChunk, onAction) {
  const boost = `[TOOL CONTEXT — files already read by the system]
${toolContext}

[YOUR JOB — CODE PHASE]
You are the coding model. Tools already gathered context above.
Output COMPLETE source using path-tagged fences (system will create/update files):

\`\`\`html file="chess/index.html"
...full file...
\`\`\`

For partial edits use REPLACE blocks:

\`\`\`replace file="chess/js/main.js"
@@@OLD
exact old snippet from the file above
@@@NEW
replacement snippet
\`\`\`

Rules:
- Advanced/modular quality (same as normal chat).
- Prefer paths under the Working dir from Agent Session.
- If a brand-new file path is unclear, put a line: NEED_PATH: filename.ext
- No capability refusals. Full code in fences.`;

  // Clean messages: last user request + boost (avoid tool-history noise)
  let userText = '';
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const m = apiMessages[i];
    if (m.role !== 'user') continue;
    userText = Array.isArray(m.content) ? m.content.map(c => c.text || '').join('\n') : String(m.content || '');
    if (userText.trim()) break;
  }

  const messages = [
    { role: 'user', content: [{ text: userText }] },
    { role: 'user', content: [{ text: boost }] }
  ];

  const options = {
    apiKey: config.apiKeyName ? ConfigManager.get(config.apiKeyName) : null,
    model: config.modelKeyName ? ConfigManager.get(config.modelKeyName) : null,
    messages,
    signal: app.currentRequestController.signal,
    tools: null,
    forceToolUse: false
  };

  let buf = '';
  // 🟢 LIVE: same collector normal agent-mode streaming uses — gives us
  // per-chunk `partial` (currently-open fence) + `newFiles` (closed fences)
  // so cards render WHILE this hidden generation is happening.
  const liveCollector = new StreamFileCollector();
  let lastPartialPaint = 0;
  const PARTIAL_MIN_INTERVAL_MS = 180;

  await config.handler.generateStream(options, app, (chunk) => {
    buf += chunk;
    onChunk(chunk);

    const { newFiles, partial } = liveCollector.push(chunk);

    for (const f of newFiles) {
      try { upsertLiveFileCard(app, f, { isCurrent: true, streaming: false }); } catch (_) {}
    }

    if (partial && partial.path) {
      const now = Date.now();
      if (now - lastPartialPaint >= PARTIAL_MIN_INTERVAL_MS) {
        lastPartialPaint = now;
        try { upsertLiveFileCard(app, partial, { isCurrent: true, streaming: true }); } catch (_) {}
      }
    }
  });

  console.log(TAG, 'codegen textLen=', buf.length);

  const applied = [];
  let successCount = 0;

  // Permission gate: show +/− diffs, Apply / Apply all (never silent write)
  try {
    const gate = await requestApplyMarkdown(app, buf, {
      onApplied: (row) => {
        onAction?.({
          id: `w-${row.path}`,
          verb: row.success ? 'Saved' : 'Save failed',
          target: row.path,
          status: row.success ? 'done' : 'error',
          fcName: 'create_or_update_file',
          url: row.url,
          detail: row.error || null,
          // 🟢 needed so ChatRenderer can rebuild the collapsible diff card
          // after history reload — see PendingWriteGate.attachApplyControls
          oldContent: row.oldContent,
          newContent: row.newContent
        });
        applied.push(row);
        if (row.success) {
          successCount++;
          AgentSession.noteWrite(app.currentConversationIndex, {
            path: row.path,
            fileNames: [row.path]
          });
        }
      }
    });
    if (gate?.applied) successCount = Math.max(successCount, gate.applied);
  } catch (e) {
    console.error(TAG, 'pending gate failed', e);
  }

  // NEED_PATH hints → surface to user
  const needPaths = [...buf.matchAll(/NEED_PATH:\s*(\S+)/gi)].map(m => m[1]);
  if (needPaths.length) {
    onChunk(`\n\nPath needed for: **${needPaths.join(', ')}** — reply with the folder path to use.`);
  }

  return { successCount, applied, textLen: buf.length, needPaths };
}

/**
 * Full dual pipeline entry. Returns { handled, actions }.
 * 🟢 Gated behind isDualAiEnabled() — OFF by default. When off, returns
 * immediately with handled:false so the caller uses the normal (tool /
 * lazy-write) path instead, no hidden second AI call happens at all.
 */
export async function runDualPipeline(app, config, apiMessages, onChunk) {
  if (!isDualAiEnabled()) {
    console.log(TAG, 'dual AI disabled (agentDualAiEnabled != true) — skipping, using normal pipeline');
    return { handled: false, actions: [], success: false, disabled: true };
  }

  const actions = [];
  const onAction = (a) => {
    actions.push(a);
    try {
      app.chatHandler?.liveUI?.logAgentAction?.(a);
    } catch (e) {
      console.warn(TAG, 'logAgentAction UI error (ignored)', e?.message || e);
    }
  };

  console.log(TAG, 'start dual pipeline');
  onAction({ id: 'dual-start', verb: 'Working', target: 'project', status: 'done' });

  const { context, actions: gatherActions } = await gatherToolContext(app, onAction);
  actions.push(...gatherActions);

  if (app.chatHandler?.liveUI?.updateAssistantMessage) {
    app.chatHandler.liveUI.updateAssistantMessage(true, 'Preparing project files…', 10000);
  }

  const gen = await generateAndApply(app, config, apiMessages, context, onChunk, onAction);

  if (gen.successCount > 0) {
    /* no chat text status — pending UI only */
    return { handled: true, actions, success: true };
  }

  console.warn(TAG, 'dual pipeline no applies, textLen=', gen.textLen);
  return { handled: false, actions, success: false, textLen: gen.textLen };
}