// src/main/agent/main/AgentLoop.js
//
// OpenCode / Claude Code style ReAct Agent Loop.
// Preserves full user/project context, enforces read-before-edit, and prevents blind overwrites.

import { ConfigManager } from '../../utils/ConfigManager.js';
import { ToolRegistry } from '../../core/tools/ToolRegistry.js';
import { AcodeFSAgent } from '../tools/AcodeFSAgent.js';
import { HeldWrites } from '../../utils/file/HeldWrites.js';
import { parseXmlStyleToolCalls, stripPseudoToolMarkup, hasPseudoToolMarkup } from '../../utils/agent/PseudoToolParser.js';

import { executeAndLogTool } from './AgentToolExecution.js';
import { hasRealWrite, hasDeliverableWrite, finalizeLiveUI, handleFinishCall } from './AgentFinish.js';
import { PLAN_TOOL_NAME, handleTodoWrite, maybeNudgeForPlan, createPlanState, looksLikeFixRequest, isTrivialChatMessage, markPlanProgressFromWrites, forceCompletePlan, formatPlanDigest } from './AgentPlanning.js';
import { AicodeHarness } from '../harness/AicodeHarness.js';
import { createNoProgressState, noteToolBatch, noteToolResults } from '../harness/NoProgressGuard.js';
import { createRunTrace, logRunStart, logStep, logCompact, logRunEnd, toolNamesFromSchema } from '../harness/RunTrace.js';
import { classifyTaskIntent } from '../harness/TaskIntent.js';
import {
  createPhaseState,
  notePhaseStep,
  phaseLabel,
  MUTATE_ONLY_ALLOWLIST,
  PHASE
} from '../harness/PhaseController.js';
import { shouldAutoExplore, runAutoExplore, formatAutoExploreInjection } from '../harness/AutoExplore.js';
import { resolveModelProfile, logModelProfile } from '../harness/ModelProfiles.js';
import { isPlanMode, planModeSystemNudge, showPlanApproveCard } from '../harness/PlanMode.js';
import { isFillerInfoMessage, isSubstantialInfoMessage, extractInfoMessage } from '../../utils/agent/AnswerInfoFilter.js';

function scheduleFollowUps(app) {
  try {
    const texts = drainFollowUp(app);
    if (!texts?.length) return;
    const next = texts[0];
    const rest = texts.slice(1);
    for (const t of rest) {
      try {
        const { enqueueFollowUp } = require('../harness/SteeringQueue.js');
      } catch (_) {}
    }
    // Re-queue remainder
    (async () => {
      try {
        const { enqueueFollowUp: enq } = await import('../harness/SteeringQueue.js');
        for (const t of rest) enq(app, t);
      } catch (_) {}
      setTimeout(() => {
        try {
          const input = document.getElementById('gpt-user-input');
          if (input) {
            input.value = next;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const send = document.getElementById('send-btn') || document.getElementById('gpt-send-btn');
          if (send) send.click();
          else if (app.chatHandler?.handleSendMessage) app.chatHandler.handleSendMessage(next);
        } catch (e) { console.warn('[AgentLoop] follow-up send', e); }
      }, 400);
    })();
  } catch (e) {
    console.warn('[AgentLoop] follow-up', e);
  }
}

import { clearSessionGrants } from '../harness/MutationGate.js';
import { drainSteering, formatSteeringInjection, clearSteeringQueue, drainFollowUp } from '../harness/SteeringQueue.js';
import { loadProjectInstructions } from '../context/ProjectInstructions.js';
import { loadRepoMapContext } from '../../context/RepoMap.js';
import { compactWorkingMessages, estimateTokens } from '../context/Compaction.js';
import { clearFileKnowledge, noteToolEvidence, formatWorkingNotes } from '../context/FileKnowledge.js';

const TAG = '[AgentLoop]';
// agentTwoPassPlanThinking (settings) reserved for plan→act double call; default off.


/**
 * Safe context pruning: ALWAYS preserves the initial conversation + user prompt (`baseCount`),
 * and keeps the most recent `keepTail` agent steps so the model NEVER forgets the user request or workspace!
 */
function pruneWorkingMessages(messages, baseCount, { maxExtraMsgs = 16, keepTail = 10 } = {}) {
  if (!Array.isArray(messages)) return messages;
  const safeBase = Math.max(1, Math.min(baseCount || 1, messages.length));
  const extraCount = messages.length - safeBase;
  if (extraCount <= maxExtraMsgs) return messages;

  const head = messages.slice(0, safeBase);
  const tail = messages.slice(-keepTail);
  const note = {
    role: 'user',
    content: [{
      text: '[SYSTEM: Earlier intermediate tool outputs in this turn were compacted to save context. Refer to the original user request above and your current plan. Use str_replace or edit_file_lines for existing files.]'
    }]
  };
  return [...head, note, ...tail];
}

function extractLastUserText(apiMessages) {
  const SKIP = /^(?:\[Agent Instructions\]|\[SYSTEM:|\[Current Project|\[Project Workspace|\[Project Memory|\[User Attached|\[System Instruction\]|You MUST only read\/write)/i;

  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const m = apiMessages[i];
    if (m.role !== 'user') continue;
    if (Array.isArray(m.content) && m.content.some(c => c.functionResponse)) continue;

    const text = Array.isArray(m.content)
      ? m.content.map(c => c.text || '').join('\n')
      : String(m.content || '');

    const trimmed = text.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
    const real = parts.filter(
      p => !SKIP.test(p) &&
           !/^FAST DEBUG MODE/i.test(p) &&
           !/^FEATURE DEVELOPMENT MODE/i.test(p)
    );

    if (real.length) return real.join('\n\n');
    if (!SKIP.test(trimmed)) return trimmed;
  }
  return '';
}

export class AgentRunner {
  static async route(app, config, modelType, apiMessages, onChunk) {
    const agentEnabled = !!((app.isEnableAgentMode || app.isEnableStudyMode) && config.supportsTools);
    const isGemini = modelType === 'gemini';
    const isClaude = modelType === 'claude';
    // Tools rebuilt each step so tool_search loads apply on the next model call
    const buildTools = () => {
      if (!agentEnabled) return null;
      if (isGemini) return ToolRegistry.getGeminiTools(app);
      if (isClaude) return ToolRegistry.getClaudeTools(app);
      return ToolRegistry.getStandardTools(app);
    };
    let tools = buildTools();

    const MAX_AGENT_STEPS = ConfigManager.get('agentMaxSteps') !== null ? parseInt(ConfigManager.get('agentMaxSteps')) : 18;
    console.log(TAG, `model=${modelType} agentEnabled=${agentEnabled} maxSteps=${MAX_AGENT_STEPS}`);

    if (!agentEnabled) {
      const options = {
        apiKey: config.apiKeyName ? ConfigManager.get(config.apiKeyName) : null,
        model: config.modelKeyName ? ConfigManager.get(config.modelKeyName) : null,
        messages: apiMessages,
        signal: app.currentRequestController.signal,
        tools: null
      };
      await config.handler.generateStream(options, app, onChunk);
      return { actions: [], filesHandled: true };
    }

    // Reset Read-Before-Edit tracker at the start of every new agent turn
    AcodeFSAgent.resetTurnReadTracker();
    try { clearFileKnowledge(app); } catch (_) {}
    try { app._autoExploreDone = false; } catch (_) {}

    // Runtime for subagents (handler + model)
    app._agentRuntime = { config, modelType, handler: config.handler };

    // Aicode Harness: run id + deferred tools reset + checkpoint
    try { AicodeHarness.startRun(app, { conversationId: String(app.currentConversationIndex ?? '') }); } catch (_) {}
    try { clearSessionGrants(app); } catch (_) {}
    try { clearSteeringQueue(app); } catch (_) {}

    const baseMessageCount = apiMessages.length;
    let workingMessages = [...apiMessages];
    const actionsTaken = [];
    const planState = createPlanState();
    const userText = extractLastUserText(apiMessages);
    const isFastDebug = looksLikeFixRequest(userText);
    try {
      const { FileChangeHistory } = await import('../../utils/agent/FileChangeHistory.js');
      FileChangeHistory.beginBatch(app, { label: String(userText || '').slice(0, 60) });
    } catch (_) {}

    // "thanks" / "ok" / hi — reply once, no tools (avoid re-exploring the project)
    if (isTrivialChatMessage(userText) && config?.handler?.generateStream) {
      console.log(TAG, 'trivial chat — tools off:', (userText || '').slice(0, 40));
      try {
        workingMessages.push({
          role: 'user',
          content: [{
            text: '[SYSTEM: User sent a short acknowledgment or greeting. Reply briefly and warmly in 1–2 sentences. Do NOT call any tools. Do NOT explore files or continue previous tasks.]'
          }]
        });
        const options = {
          apiKey: config.apiKeyName ? ConfigManager.get(config.apiKeyName) : null,
          model: config.modelKeyName ? ConfigManager.get(config.modelKeyName) : null,
          messages: workingMessages,
          signal: app.currentRequestController?.signal,
          tools: [],
          forceToolUse: false,
          disableThinking: true,
          maxOutputTokensOverride: 256
        };
        const result = await config.handler.generateStream(options, app, onChunk);
        const text = (result?.rawParts || []).map(p => p.text || '').join('') || result?.text || '';
        if (text && onChunk) onChunk(text);
        try { await AicodeHarness.finishRun(app, 'done'); } catch (_) {}
        try { await finalizeLiveUI(app, [], planState); } catch (_) {}
        return { actions: [], filesHandled: true, trivial: true };
      } catch (e) {
        console.warn(TAG, 'trivial path failed, falling through', e?.message || e);
      }
    }

    // M1: intent-based mutate tool preload (enhance/style/improve/… included)
    let taskIntent = { kind: 'mixed', preloadMutate: false };
    try {
      taskIntent = classifyTaskIntent(userText || '');
      if (taskIntent.preloadMutate) {
        ToolRegistry.loadTools(app, ['write', 'str_replace', 'edit_file_lines']);
      }
      if (/\b(rename|move|copy)\b/i.test(userText || '')) {
        ToolRegistry.loadTools(app, ['rename_path', 'move_path', 'copy_path', 'delete_item', 'read', 'write']);
      }
      try { app._agentTaskIntent = taskIntent; } catch (_) {}
    } catch (_) {}

    // Prefer concrete model slug (e.g. gemini-2.5-flash) over provider type "gemini"
    const modelIdForProfile = (
      (config?.modelKeyName ? ConfigManager.get(config.modelKeyName) : null)
      || app.selectedModelId
      || app.selectedModel?.id
      || app.selectedModel?.model
      || app.selectedModel?.name
      || app.selectedModelType
      || ''
    );
    const modelProfile = resolveModelProfile(modelIdForProfile);
    logModelProfile(modelProfile, modelIdForProfile);
    const phaseState = createPhaseState(taskIntent || app._agentTaskIntent || {}, modelProfile);
    try { app._agentModelProfile = modelProfile; } catch (_) {}
    try { app._agentPhaseState = phaseState; } catch (_) {}


    try {
      if (/\bsubagent\b|\bexplore (this|the) project\b|\buse (a |an )?subagent\b/i.test(userText || '')) {
        ToolRegistry.loadTools(app, ['subagent', 'read', 'list_directory', 'glob', 'grep']);
        workingMessages.push({
          role: 'user',
          content: [{
            text: '[SYSTEM: User asked for a subagent. You MUST call the subagent tool first with type=explore and a clear task. Do NOT read many files yourself — let the subagent explore and return a report, then summarize that report for the user.]'
          }]
        });
      }
    } catch (_) {}


    try {
      const hasRealUrl = /https?:\/\/[a-z0-9.-]+/i.test(userText || '');
      const asksFetch = /\b(fetch|open|read)\b.{0,40}\b(url|page|website|site)\b/i.test(userText || '');
      if (hasRealUrl || asksFetch) {
        ToolRegistry.loadTools(app, ['fetch_content', 'web_search']);
        workingMessages.push({
          role: 'user',
          content: [{
            text: '[SYSTEM: User provided a URL or asked to fetch a page. Call fetch_content with a PLAIN https URL only (no HTML attributes). Do not invent page content.]'
          }]
        });
      }
      // Pure local edit requests — do not browse
      if (/\b(fix|edit|patch|line\s*\d+)\b/i.test(userText || '') &&
          /\.(js|ts|tsx|jsx|css|html|py|java|kt|json|md)\b/i.test(userText || '') &&
          !hasRealUrl) {
        ToolRegistry.loadTools(app, ['str_replace', 'edit_file_lines', 'write']);
        workingMessages.push({
          role: 'user',
          content: [{
            text: '[SYSTEM: LOCAL FILE FIX — Do NOT call web_search or fetch_content. Read the file, then use edit_file_lines (preferred for line fixes) or str_replace. Keep edits small for free-tier token limits.]'
          }]
        });
      }
      // Advanced edit only if setting enabled
      if (/\bapply_patch\b|\bunified diff\b|\bmulti_edit\b/i.test(userText || '')) {
        try {
          const { isAdvancedEditEnabledSync } = await import('../../core/tools/ToolRegistry.js');
          if (isAdvancedEditEnabledSync()) {
            ToolRegistry.loadTools(app, ['apply_patch', 'multi_edit', 'str_replace', 'edit_file_lines', 'read', 'get_diagnostics']);
            workingMessages.push({
              role: 'user',
              content: [{
                text:
                  '[SYSTEM: Advanced edit enabled. Prefer apply_patch or multi_edit as requested. Include context lines in diffs.]'
              }]
            });
          } else {
            ToolRegistry.loadTools(app, ['str_replace', 'edit_file_lines', 'read']);
            workingMessages.push({
              role: 'user',
              content: [{
                text:
                  '[SYSTEM: multi_edit/apply_patch are OFF (Agent Settings → Advanced edit tools). Use edit_file_lines or str_replace instead. User can enable Advanced edit for free-tier-heavy multi-hunk tools.]'
              }]
            });
          }
        } catch (_) {
          ToolRegistry.loadTools(app, ['str_replace', 'edit_file_lines', 'read']);
        }
      }
    } catch (_) {}


    try {
      // Strict single-tool tests (e.g. "Use the read tool on path \".\" only")
      if (/\buse the read tool\b/i.test(userText || '') ||
          (/\bread\b/i.test(userText || '') && /path\s*[:=]?\s*[\"']?\.\s*[\"']?/i.test(userText || '') && /\bonly\b/i.test(userText || ''))) {
        workingMessages.push({
          role: 'user',
          content: [{
            text: '[SYSTEM: User is testing the read tool. Call read EXACTLY once with path exactly as they specified (e.g. "."). Do NOT read other files. Do NOT list_directory. Do NOT fix bugs, plan, or edit. After the tool result, briefly report the tool error or content — nothing else.]'
          }]
        });
      }
    } catch (_) {}


    try {
      if (/\bcodemode\b|\bbatch (read|edit|file)/i.test(userText || '')) {
        ToolRegistry.loadTools(app, ['codemode', 'write', 'str_replace', 'read', 'list_directory', 'glob']);
        workingMessages.push({
          role: 'user',
          content: [{
            text: '[SYSTEM: User asked for codemode. You MUST call the codemode tool with a JS body that uses await tools.read / tools.list_directory / etc. Do NOT call read or list_directory as separate tools. Do NOT invent file lists from memory.]'
          }]
        });
      }
    } catch (_) {}

    try {
      if (/\brename\b/i.test(userText || '')) {
        workingMessages.push({
          role: 'user',
          content: [{
            text: '[SYSTEM: User asked to rename a file. Use the rename_path tool (path + new_name). Do NOT recreate+delete unless rename_path fails.]'
          }]
        });
      }
    } catch (_) {}


    try {
      if (/\bsub\s*-?agent\b|\buse a subagent\b|\bexplore this project\b/i.test(userText || '')) {
        workingMessages.push({
          role: 'user',
          content: [{
            text: '[SYSTEM: User asked for a subagent. You MUST call the subagent tool first (type="explore", task=clear description of what to find). Do NOT read many files yourself in the parent — let the subagent explore and return a report, then summarize that report to the user.]'
          }]
        });
      }
    } catch (_) {}

    // Project instructions once per agent run (AGENTS.md / CLAUDE.md / .aicodex/project_memory.md)
    try {
      const inst = await loadProjectInstructions();
      if (inst?.text) {
        workingMessages.push({
          role: 'user',
          content: [{ text: inst.text }]
        });
        console.log(TAG, 'Injected project instructions from', inst.sources?.join(', '));
      }
    } catch (e) {
      console.warn(TAG, 'project instructions', e);
    }

    // Compact project file map (cached .aicodex/repomap.json)
    try {
      const rm = await loadRepoMapContext({ force: false });
      if (rm) {
        workingMessages.push({
          role: 'user',
          content: [{ text: rm }]
        });
        console.log(TAG, 'Injected repomap context');
      }
    } catch (e) {
      console.warn(TAG, 'repomap', e);
    }

    try {
      if (/\b(what files|list (all )?files|project structure|files in (this|the) project)\b/i.test(userText || '')) {
        workingMessages.push({
          role: 'user',
          content: [{
            text: '[SYSTEM: Answer ONLY from the injected [Project repomap] and/or list_directory/read tools. Do NOT invent files (e.g. index.html, css/) that are not in the repomap or directory listing.]'
          }]
        });
      }
    } catch (_) {}

    // Current date (Claude Code-style — models often lag on year)
    try {
      const y = new Date().getUTCFullYear();
      const d = new Date().toISOString().slice(0, 10);
      workingMessages.push({
        role: 'user',
        content: [{
          text: `[SYSTEM: Current date is ${d} (UTC). Calendar year is ${y}. When answering time-sensitive questions or building search queries, use ${y}, not older training-cutoff years.]`
        }]
      });
    } catch (_) {}

    // Plan mode: research-only system constraint
    try {
      if (isPlanMode()) {
        workingMessages.push({
          role: 'user',
          content: [{ text: planModeSystemNudge() }]
        });
        console.log(TAG, 'Plan mode ON — research-only nudge injected');
      }
    } catch (_) {}

    // Web tool discipline (Claude-style) when browsing enabled
    try {
      if (app.isEnableWebBrowsing) {
        workingMessages.push({
          role: 'user',
          content: [{
            text:
              '[SYSTEM: WEB TOOL DISCIPLINE]\n' +
              '- Today (UTC): ' + new Date().toISOString().slice(0, 10) +
              ' (year ' + String(new Date().getUTCFullYear()) + '). Use this year in queries when needed — do not default to 2024/2025 from training data.\n' +
              '- web_search only for live facts, docs, changelogs, unknown URLs.\n' +
              '- Never search greetings/thanks or pure local coding.\n' +
              '- Prefer project files / repomap / memory first.\n' +
              '- Workflow: web_search (focused query; set fetch_top=true for docs) → or fetch_content(best URL) → answer with links.\n' +
              '- Query tips: "Node.js LTS site:nodejs.org" not "Node.js LTS 2025".\n' +
              '- For large docs, use headings from fetch_content to jump to the right section; do not invent API from memory when a page was fetched.\n' +
              '- Local file/line fixes: never browse; prefer edit_file_lines or str_replace (small tokens).\n' +
              '- fetch_content URL must be a clean https://host/path — never HTML like href= or target=_blank.'
          }]
        });
      }
    } catch (_) {}

    // UserPromptSubmit hooks
    try {
      const { runUserPromptSubmitHooks } = await import('../harness/AgentHooks.js');
      const { injectTexts } = await runUserPromptSubmitHooks(userText || '');
      for (const inj of injectTexts || []) {
        workingMessages.push({
          role: 'user',
          content: [{ text: '[HOOK UserPromptSubmit]\n' + inj }]
        });
      }
      if (injectTexts?.length) console.log(TAG, 'UserPromptSubmit injects', injectTexts.length);
    } catch (_) {}

    let forceToolUse = false; // Let model choose tools naturally; only force on nudges
    let emptyStreak = 0;
    const counters = {
      autoCorrectCount: 0,
      writeFailCount: 0,
      exploreStreak: 0,
      readFp: new Set(),
      previewUnlocked: false
    };
    let prevFunctionCallsString = '';

    // M0: baseline trace (tools loaded after all preload heuristics)
    let runTrace = null;
    try {
      tools = buildTools();
      runTrace = createRunTrace({
        model: modelType,
        userHead: userText,
        maxSteps: MAX_AGENT_STEPS
      });
      logRunStart(runTrace, {
        tools,
        deferredLoaded: ToolRegistry.getLoadedToolNames(app),
        phase: 'start'
      });
      try {
        console.log('[RunTrace] intent', taskIntent);
      } catch (_) {}
      app._agentRunTrace = runTrace;
    } catch (e) {
      console.warn(TAG, 'RunTrace start failed', e?.message || e);
    }

    const noProgress = createNoProgressState();

    try { app.chatHandler?.liveUI?.resetAgentClock?.(); } catch (_) {}
    app._heldToolCalls = app._heldToolCalls || [];

    const safeLogAction = (actionData) => {
      if (app.chatHandler?.liveUI && typeof app.chatHandler.liveUI.logAgentAction === 'function') {
        app.chatHandler.liveUI.logAgentAction(actionData);
      }
    };

    const safeChunk = (chunk) => {
      try {
        if (chunk && hasPseudoToolMarkup(String(chunk))) onChunk(stripPseudoToolMarkup(String(chunk)));
        else onChunk(chunk);
      } catch (_) { onChunk(chunk); }
    };

    for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
      if (step === 2) {
        const nudge = maybeNudgeForPlan({ step, userText, planState, hasAnyWrite: hasRealWrite(actionsTaken, app) });
        if (nudge) workingMessages.push({ role: 'user', content: [{ text: nudge }] });
      }

      {
        let cOpts = {
          maxExtraMsgs: (modelProfile && modelProfile.compactMaxExtraMsgs) || 28,
          keepTail: (modelProfile && modelProfile.compactKeepTail) || 12,
          tokenBudget: ConfigManager.get('historyTokenBudget') != null
            ? parseInt(ConfigManager.get('historyTokenBudget'), 10) : 12000
        };
        if (app._forceCompactNext) {
          cOpts = { maxExtraMsgs: 0, keepTail: 8, tokenBudget: 1 };
          app._forceCompactNext = false;
        }
        try {
          const notes = formatWorkingNotes(app);
          if (notes) cOpts.workingNotes = notes;
        } catch (_) {}
        const c = compactWorkingMessages(workingMessages, baseMessageCount, cOpts);
        workingMessages = c.messages;
        if (c.compacted) {
          console.log(TAG, `context compacted tokens ${c.beforeTokens}→${c.afterTokens} dropped=${c.dropped}`);
          try {
            const notes = formatWorkingNotes(app);
            if (notes) {
              // Ensure notes survive even if digest strip failed
              const last = workingMessages[workingMessages.length - 1];
              const lastText = Array.isArray(last?.content)
                ? last.content.map(x => x.text || '').join('')
                : String(last?.content || '');
              if (!lastText.includes('[Working Notes')) {
                workingMessages.push({
                  role: 'user',
                  content: [{ text: '[SYSTEM]\n' + notes }]
                });
              }
            }
          } catch (_) {}
          try {
            app._lastCompactStep = step;
            logCompact(runTrace, {
              step,
              beforeTokens: c.beforeTokens,
              afterTokens: c.afterTokens,
              dropped: c.dropped
            });
          } catch (_) {}
        }
      }

      // OpenCode-style: remind model of locked plan + NEXT required step every iteration
      if (planState.hasPlan && !planState.allDone && step > 1) {
        const digest = formatPlanDigest(planState);
        if (digest) {
          const last = workingMessages[workingMessages.length - 1];
          const lastText = Array.isArray(last?.content)
            ? last.content.map(c => c.text || '').join('')
            : String(last?.content || '');
          if (!lastText.includes('[PLAN STATUS]')) {
            workingMessages.push({
              role: 'user',
              content: [{
                text: `[SYSTEM: ${digest}\nYou MUST implement the NEXT REQUIRED step with tools before anything else. Do not skip steps. Do not mark later steps done early. Call todo_write only to update statuses for steps you actually finished.]`
              }]
            });
          }
        }
      }

      // Refresh schemas after tool_search / heuristic loads
      if (forceToolUse) {
        try { ToolRegistry.loadTools(app, ['write', 'str_replace', 'edit_file_lines', 'run_command']); } catch (_) {}
      }
      tools = buildTools();
      try { await AicodeHarness.checkpoint(app, { step, meta: { loaded: ToolRegistry.getLoadedToolNames(app) } }); } catch (_) {}

      // Live tool-arg stream → progressive diff cards (OpenAI-compat / OpenRouter)
      let _partialPaintAt = 0;
      const onToolPartial = (partial) => {
        try {
          const name = partial?.name || '';
          if (!['write', 'create_or_update_file', 'str_replace', 'search_replace_edit', 'edit_file_lines'].includes(name)) return;
          const now = Date.now();
          if (now - _partialPaintAt < 80) return; // throttle paints ~12fps
          _partialPaintAt = now;
          app.chatHandler?.liveUI?.logStreamingToolArgs?.(partial);
        } catch (_) {}
      };

      const options = {
        apiKey: config.apiKeyName ? ConfigManager.get(config.apiKeyName) : null,
        model: config.modelKeyName ? ConfigManager.get(config.modelKeyName) : null,
        messages: workingMessages,
        signal: app.currentRequestController.signal,
        tools,
        forceToolUse,
        // M3: force mode = phase allowlist (mutate-only)
        allowedFunctionNames: forceToolUse
          ? (app._agentForceAllowlist || MUTATE_ONLY_ALLOWLIST)
          : undefined,
        disableThinking: false,
        maxOutputTokensOverride: 8192,
        onToolPartial
      };

      let result;
      try {
        result = await config.handler.generateStream(options, app, safeChunk);
        if (app.currentRequestController?.signal?.aborted) {
          try { await AicodeHarness.finishRun(app, 'aborted'); } catch (_) {}
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        if (result && result.error) throw new Error(result.error);
      } catch (e) {
        console.error(TAG, `generateStream threw on step ${step}:`, e);
        try { app._lastAgentError = e; } catch (_) {}
        throw e;
      }

      let functionCalls = result?.functionCalls || [];
      let rawParts = result?.rawParts || functionCalls.map(fc => ({ functionCall: fc }));

      // M3/M7 harden: when force-write allowlist is active, drop explore-only calls.
      // If ALL calls were explore → do NOT die empty: queue force-write recovery.
      let forceStripEmptied = false;
      try {
        const allow = app._agentForceAllowlist;
        if (forceToolUse && Array.isArray(allow) && allow.length && functionCalls.length) {
          const allowSet = new Set(allow);
          const before = functionCalls.map(f => f?.name).filter(Boolean);
          const kept = functionCalls.filter(f => allowSet.has(f?.name));
          if (kept.length < functionCalls.length) {
            console.log(TAG, 'force allowlist stripped tools', {
              before,
              after: kept.map(f => f?.name)
            });
            functionCalls = kept;
            if (!functionCalls.length) {
              forceStripEmptied = true;
              counters.forceStripEmpty = (counters.forceStripEmpty || 0) + 1;
              workingMessages.push({
                role: 'user',
                content: [{
                  text: '[SYSTEM: FORCE WRITE is active. Explore tools (read/grep/outline/list) are disabled this turn. You MUST call str_replace or edit_file_lines on the file you already saw — do not read again.]'
                }]
              });
            }
          }
        }
      } catch (_) {}

      // Recovery: stripped-to-empty → run dedicated force write pass once (best path vs silent stop)
      if (forceStripEmptied && !counters.forceWritePassDone && !hasRealWrite(actionsTaken, app)) {
        counters.forceWritePassDone = true;
        try {
          console.log(TAG, 'forceStripEmptied → forceToolWritePass');
          const { forceToolWritePass } = await import('./AgentForceWritePass.js');
          const fw = await forceToolWritePass(
            app, config, tools, apiMessages, workingMessages,
            onChunk, actionsTaken, safeLogAction, planState
          );
          if (fw?.ok || hasRealWrite(actionsTaken, app)) {
            try {
              if (phaseState) {
                phaseState.mutated = true;
                phaseState.phase = PHASE.IMPLEMENT;
                phaseState.forceArmed = false;
              }
            } catch (_) {}
            forceToolUse = false;
            app._agentForceAllowlist = null;
            try { await AicodeHarness.finishRun(app, 'done'); } catch (_) {}
            await finalizeLiveUI(app, actionsTaken, planState);
            return { actions: actionsTaken, filesHandled: true, recoveredForceWrite: true };
          }
        } catch (e) {
          console.warn(TAG, 'forceStrip recovery failed', e?.message || e);
        }
      }

      // Still empty after strip + recovery attempts → soft continue (not hard stop yet)
      if (forceStripEmptied && !functionCalls.length) {
        if ((counters.forceStripEmpty || 0) < 3 && step < MAX_AGENT_STEPS) {
          forceToolUse = true;
          try { ToolRegistry.loadTools(app, ['write', 'str_replace', 'edit_file_lines']); } catch (_) {}
          continue;
        }
        // Exhausted recovery — clear stop with user-visible reason
        console.log(TAG, 'stop — force-write but model only explored', {
          step,
          stripCount: counters.forceStripEmpty
        });
        try { await AicodeHarness.finishRun(app, 'force_write_no_edit'); } catch (_) {}
        await finalizeLiveUI(app, actionsTaken, planState);
        try {
          const { eventForAgentStop } = await import('../../utils/message/StopReason.js');
          const { pushChatEvent } = await import('../../ui/chatInput/SlashCommands.js');
          const ev = eventForAgentStop('force_write_no_edit') || {
            kind: 'error',
            text: 'Stopped — force-write active but the model kept reading instead of editing. Retry or switch model.'
          };
          await pushChatEvent(app, ev);
        } catch (_) {}
        return { actions: actionsTaken, filesHandled: false, stoppedReason: 'force_write_no_edit' };
      }
      let textOutput = rawParts
        .filter(p => p && (p.text != null) && p.type !== 'thinking' && p.type !== 'redacted_thinking' && !p.thinking)
        .map(p => p.text || '')
        .join('')
        .trim();
      // Also collect Anthropic text-typed blocks only
      if (!textOutput) {
        textOutput = rawParts
          .filter(p => p && p.type === 'text')
          .map(p => p.text || '')
          .join('')
          .trim();
      }

      if (!functionCalls.length && hasPseudoToolMarkup(textOutput)) {
        const pseudo = parseXmlStyleToolCalls(textOutput);
        if (pseudo.length) {
          functionCalls = pseudo;
          textOutput = stripPseudoToolMarkup(textOutput);
        }
      }

      try {
        const t = String(textOutput || '');
        console.log('[AgentLoop] step', step, {
          tools: functionCalls.map(f => f?.name).filter(Boolean),
          textLen: t.length,
          textHead: t.slice(0, 80),
          textTail: t.slice(-60),
          endsMidSentence: !!(t.trim() && !/[.!?…]$/.test(t.trim())),
          finishReason: result?.finishReason || null
        });
        logStep(runTrace, {
          step,
          phase: (phaseState && phaseState.phase) ||
            (functionCalls.some(f => /write|str_replace|edit_file/.test(f?.name || '')) ? 'implement' : 'explore'),
          tools: tools,
          toolsLoaded: toolNamesFromSchema(tools),
          toolsCalled: functionCalls.map(f => f?.name).filter(Boolean),
          textLen: t.length,
          textHead: t.slice(0, 80),
          finishReason: result?.finishReason || null,
          compacted: !!app._lastCompactStep && app._lastCompactStep === step,
          forceToolUse: !!forceToolUse
        });
      } catch (_) {}

      // Informational / Q&A tool call — filter filler; never kill mutate runs without edits
      const infoCall = functionCalls.find(fc => fc.name === 'answer_informational_query');
      if (infoCall) {
        const txt = extractInfoMessage(infoCall);
        const filler = isFillerInfoMessage(txt);
        const substantial = isSubstantialInfoMessage(txt);
        const mutated = hasRealWrite(actionsTaken, app);
        const intentKind = (taskIntent || app._agentTaskIntent || {}).kind || phaseState?.kind || 'mixed';
        const needsEdit = intentKind === 'mutate' && !mutated;

        if (filler) {
          console.log(TAG, 'answer_informational_query filler ignored', { len: txt.length, head: txt.slice(0, 60) });
          // Drop this tool from the batch mindset — nudge to real work
          if (needsEdit && step < MAX_AGENT_STEPS) {
            workingMessages.push({
              role: 'user',
              content: [{
                text: '[SYSTEM: Do not call answer_informational_query with status lines. Apply the user change with str_replace or edit_file_lines now, then finish_task.]'
              }]
            });
            forceToolUse = true;
            try { ToolRegistry.loadTools(app, ['write', 'str_replace', 'edit_file_lines']); } catch (_) {}
            continue;
          }
          // readonly / already done: ignore filler and keep going unless empty batch
        } else if (substantial) {
          // Parent prose once — not a step-rail dump of every message
          onChunk(txt.startsWith('\n') ? txt : ('\n\n' + txt));
          if (!counters.infoAnsweredUi) {
            counters.infoAnsweredUi = true;
            safeLogAction({
              id: 'answered-chat',
              verb: 'Answered',
              target: 'Chat',
              status: 'done'
            });
          }
        } else if (txt) {
          // Borderline: show prose only, no extra rail spam
          onChunk(txt.startsWith('\n') ? txt : ('\n\n' + txt));
        }

        // Mutate still pending → do NOT finish the agent run
        if (needsEdit && step < MAX_AGENT_STEPS) {
          workingMessages.push({
            role: 'user',
            content: [{
              text: '[SYSTEM: User asked for file changes. answer_informational_query is not enough — call str_replace or edit_file_lines on the target file now.]'
            }]
          });
          forceToolUse = true;
          try { ToolRegistry.loadTools(app, ['write', 'str_replace', 'edit_file_lines']); } catch (_) {}
          // Remove info calls so they are not executed as "done" side-path
          functionCalls = functionCalls.filter(fc => fc.name !== 'answer_informational_query');
          if (!functionCalls.length) continue;
        } else if (!needsEdit && (substantial || intentKind === 'readonly')) {
          try { await AicodeHarness.finishRun(app, 'done'); } catch (_) {}
          await finalizeLiveUI(app, actionsTaken, planState);
          return { actions: actionsTaken, filesHandled: true };
        } else {
          functionCalls = functionCalls.filter(fc => fc.name !== 'answer_informational_query');
          if (!functionCalls.length) continue;
        }
      }


      // Close Thought before tool rows; keep monologue inside Thought for this step
      try {
        const ch = app.chatHandler;
        const turn = app._currentTurn;
        if (ch && turn && functionCalls.length > 0) {
          ch._closeCurrentThinking?.(turn);
        }
      } catch (_) {}

      const hasCodeBlocks = /```[\s\S]{40,}```/.test(textOutput);
      const isEmpty = textOutput.length === 0;

      // Handle turns where the model returned NO tool calls
      if (functionCalls.length === 0) {
        // Keep force mode if mutate task still has no edits (empty ≠ done)
        if (hasRealWrite(actionsTaken, app) || (phaseState && phaseState.kind === 'readonly')) {
          forceToolUse = false;
        }
        // Final agent step: show answer prose (monologue may already sit in Thought from stream)
        try {
          const ch = app.chatHandler;
          const turn = app._currentTurn;
          if (ch && turn) {
            ch._closeCurrentThinking?.(turn);
            // Do NOT re-onChunk monologue (already in Thought when Think ON). Avoids leak outside.
            // Final prose only if Think OFF and something was buffered server-side.
            const clean = stripPseudoToolMarkup(String(textOutput || '').replace(/TASK_COMPLETED/g, '')).trim();
            if (clean && !app?.chatInputUI?.states?.think) {
              const hasText = Array.isArray(turn.parts) && turn.parts.some(p => p?.type === 'text' && String(p.text || '').trim());
              if (!hasText) onChunk(clean.startsWith('\n') ? clean : ('\n\n' + clean));
            }
          }
        } catch (_) {}
        const cleanText = stripPseudoToolMarkup(textOutput.replace(/TASK_COMPLETED/g, '')).trim();
        const hasWriteAction = hasRealWrite(actionsTaken, app);
        const planOpen = planState?.hasPlan && !planState?.allDone;

        // If the model pasted raw code blocks in chat instead of using tools during a coding task
        if (app.isEnableAgentMode && hasCodeBlocks && !hasWriteAction && step < MAX_AGENT_STEPS && counters.autoCorrectCount < 2) {
          counters.autoCorrectCount++;
          workingMessages.push({ role: 'model', content: [{ text: textOutput || ' ' }] });
          workingMessages.push({
            role: 'user',
            content: [{
              text: "[SYSTEM: Do NOT paste code blocks in chat when Agent Mode is active. First call 'read' on the target file (if existing), then apply the changes using 'str_replace' or 'edit_file_lines' (or 'write' for a brand new file).]"
            }]
          });
          forceToolUse = true;
          continue;
        }

        // If empty response mid-workflow
        if (app.isEnableAgentMode && isEmpty && step < MAX_AGENT_STEPS) {
          emptyStreak++;
          if (hasDeliverableWrite(actionsTaken, app) && !planOpen) {
            await finalizeLiveUI(app, actionsTaken, planState);
            return { actions: actionsTaken, filesHandled: true };
          }
          if (emptyStreak <= 2) {
            workingMessages.push({
              role: 'user',
              content: [{
                text: "[SYSTEM: Empty response received. Continue executing the next pending step using tools ('read', 'str_replace', 'edit_file_lines', or 'finish_task' if all changes are complete).]"
              }]
            });
            forceToolUse = true;
            continue;
          }
        }

        // OpenCode-style: plan open → refuse to stop; force next pending step (up to 6 nudges)
        if (app.isEnableAgentMode && planOpen && step < MAX_AGENT_STEPS && counters.autoCorrectCount < 6) {
          counters.autoCorrectCount++;
          const nextPending = (planState.items || []).find(it => it.status !== 'done');
          const focusTarget = nextPending ? `"${nextPending.text || nextPending.task}"` : 'the remaining plan items';
          const digest = formatPlanDigest(planState);
          workingMessages.push({ role: 'model', content: [{ text: textOutput || ' ' }] });
          workingMessages.push({
            role: 'user',
            content: [{
              text: `[SYSTEM: STOP. Plan is incomplete. ${digest || `Pending: ${focusTarget}`}\nImplement ONLY the NEXT REQUIRED step now using read/str_replace/edit_file_lines/write. Do not call finish_task. Do not skip to later steps.]`
            }]
          });
          forceToolUse = true;
          continue;
        }

        // Incomplete monologue / length truncation → keep working (don't silent-stop)
        const looksIncomplete =
          result?.finishReason === 'length' ||
          /\b(let me|i('ll| will)|next i|now i|reading|looking|i need to)\b/i.test(cleanText || '') ||
          (/[A-Za-z0-9]$/.test((cleanText || '').trim()) && (cleanText || '').length < 400);
        const noDeliverableYet = !hasDeliverableWrite(actionsTaken, app) && !hasWriteAction;
        if (
          app.isEnableAgentMode &&
          looksIncomplete &&
          noDeliverableYet &&
          step < MAX_AGENT_STEPS &&
          counters.autoCorrectCount < 8
        ) {
          counters.autoCorrectCount++;
          console.warn('[AgentLoop] incomplete step — nudging continue', {
            step,
            finishReason: result?.finishReason,
            textHead: String(cleanText || '').slice(0, 80)
          });
          workingMessages.push({ role: 'model', content: [{ text: textOutput || ' ' }] });
          workingMessages.push({
            role: 'user',
            content: [{
              text:
                "[SYSTEM: Your previous reply was cut off or only described the next step without applying it. " +
                "Continue NOW: call the needed tools (read/str_replace/edit_file_lines/write). " +
                "Do not stop with only a sentence. Complete the user request, then finish_task.]"
            }]
          });
          forceToolUse = true;
          continue;
        }

        const stopReason = hasWriteAction
          ? 'done'
          : ((forceToolUse || app._agentForceAllowlist)
            ? 'force_write_no_edit'
            : ((cleanText || '').length ? 'done' : 'empty_stop'));
        console.log('[AgentLoop] stop — no tools this step', {
          step,
          finishReason: result?.finishReason,
          textLen: (cleanText || '').length,
          hasWrite: hasWriteAction,
          stopReason
        });
        try { await AicodeHarness.finishRun(app, stopReason); } catch (_) {}
        await finalizeLiveUI(app, actionsTaken, planState);
        if (stopReason !== 'done') {
          try {
            const { eventForAgentStop } = await import('../../utils/message/StopReason.js');
            const { pushChatEvent } = await import('../../ui/chatInput/SlashCommands.js');
            const ev = eventForAgentStop(stopReason) || {
              kind: 'error',
              text: stopReason === 'force_write_no_edit'
                ? 'Stopped — model did not apply an edit under force-write. Retry or switch model.'
                : 'Stopped — empty step with no file changes.'
            };
            await pushChatEvent(app, ev);
          } catch (_) {}
        }
        return { actions: actionsTaken, filesHandled: hasWriteAction, stoppedReason: stopReason };
      }

      // Prevent identical consecutive tool calls + broader no-progress guard
      const currentFcString = JSON.stringify(functionCalls.map(f => ({ n: f.name, a: f.args })));
      const npBatch = noteToolBatch(noProgress, functionCalls);
      if (currentFcString === prevFunctionCallsString || npBatch.stuck) {
        workingMessages.push({ role: 'model', content: rawParts });
        // Mistral/OpenAI: every tool_call needs a tool result before the next user message
        workingMessages.push({
          role: 'user',
          content: functionCalls.filter(f => f.name !== 'finish_task').map(fc => ({
            functionResponse: {
              name: fc.name,
              id: fc.id,
              response: { error: 'repeated_or_stuck', skipped: true }
            }
          }))
        });
        workingMessages.push({
          role: 'user',
          content: [{
            text: npBatch.nudge ||
              "[SYSTEM: You just repeated the exact same tool call with identical arguments. Do not repeat it. Proceed to the next step or call 'finish_task' if done.]"
          }]
        });
        prevFunctionCallsString = '';
        if (npBatch.forceFinish) {
          try { await AicodeHarness.finishRun(app, 'no_progress'); } catch (_) {}
          await finalizeLiveUI(app, actionsTaken, planState);
          try {
          const { eventForAgentStop } = await import('../../utils/message/StopReason.js');
          const { pushChatEvent } = await import('../../ui/chatInput/SlashCommands.js');
          const ev = eventForAgentStop('no_progress');
          if (ev) await pushChatEvent(app, ev);
        } catch (_) {}
          return { actions: actionsTaken, filesHandled: true, stoppedReason: 'no_progress' };
        }
        forceToolUse = true;
        continue;
      }
      prevFunctionCallsString = currentFcString;

      if (hasCodeBlocks) rawParts = rawParts.filter(p => !p.text);
      workingMessages.push({ role: 'model', content: rawParts });
      const responses = [];

      for (const fc of functionCalls) {
        if (fc.name === 'finish_task') continue;

        if (fc.name === 'preview_html') {
          const wrote = hasRealWrite(actionsTaken, app) || counters.previewUnlocked;
          if (!wrote) {
            const err = { error: 'SYSTEM: preview_html is only needed after modifying or creating files.' };
            responses.push({ functionResponse: { name: fc.name, id: fc.id, response: err } });
            actionsTaken.push({ verb: 'Blocked', label: 'preview_html', status: 'error', fcName: 'preview_html', detail: err.error });
            continue;
          }
        }

        // Range-aware Read Fingerprint: allows reading different line ranges of the same file!
        if (fc.name === 'read' || fc.name === 'read_file') {
          const args = fc.args || fc.arguments || {};
          const rawPath = String(args.path || args.file || '').trim().toLowerCase();
          const rangeKey = `${rawPath}:${args.start_line || 1}-${args.end_line || 'end'}`;
          if (counters.readFp.has(rangeKey)) {
            const err = {
              error: `SYSTEM: You already read ${rawPath} (lines ${args.start_line || 1}-${args.end_line || 'end'}) with no edits in between. Use the content already in context, or pass a different start_line/end_line if reading further down.`
            };
            responses.push({ functionResponse: { name: fc.name, id: fc.id, response: err } });
            actionsTaken.push({ verb: 'Skipped', label: rawPath.split('/').pop(), status: 'done', fcName: fc.name, detail: err.error, fcArgs: args });
            continue;
          }
          counters.readFp.add(rangeKey);
        }

        if (fc.name === PLAN_TOOL_NAME) {
          const planResp = await handleTodoWrite({ app, fc, safeLogAction, planState, actionsTaken });
          if (planResp?.functionResponse) responses.push(planResp);
          else if (planResp) responses.push({ functionResponse: planResp });
          if (!planState.allDone) planState.justPlanned = true;
          continue;
        }

        const actionId = `s${step}-${fc.id || fc.name}-${Math.random().toString(36).slice(2, 7)}`;
        const { toolResult } = await executeAndLogTool({ app, fc, actionId, safeLogAction, actionsTaken });

        if (['write', 'str_replace', 'create_or_update_file', 'search_replace_edit', 'edit_file_lines', 'update_project_memory', 'preview_html'].includes(fc.name)
            && toolResult && !toolResult.error && toolResult.success !== false) {
          counters.previewUnlocked = true;
          counters.readFp.clear(); // File changed, allow re-reading if needed
          counters.exploreStreak = 0;
          forceToolUse = false;
          // Keep sticky plan card in sync even if the model skips todo_write updates (Qwen etc.)
          try {
            markPlanProgressFromWrites(app, planState, actionsTaken);
          } catch (_) {}
        }

        const aiContextResponse = toolResult && typeof toolResult === 'object' ? { ...toolResult } : toolResult;
        if (aiContextResponse && typeof aiContextResponse === 'object') {
          delete aiContextResponse.oldContent;
          delete aiContextResponse.newContent;
          if (['write', 'str_replace', 'create_or_update_file', 'edit_file_lines', 'search_replace_edit', 'create_file_tree', 'update_project_memory'].includes(fc.name)) {
            delete aiContextResponse.content;
          }
        }
        responses.push({ functionResponse: { name: fc.name, id: fc.id, response: aiContextResponse } });
      }

      // Check if finish_task was called in this batch
      const finishCall = functionCalls.find(fc => fc.name === 'finish_task');
      if (finishCall) {
        if (responses.length > 0) {
          try {
        for (const r of responses) {
          const fr = r?.functionResponse;
          if (fr?.name) noteToolEvidence(app, fr.name, fr.response || {}, {});
        }
      } catch (_) {}
      workingMessages.push({ role: 'user', content: responses });
          // Mid-run user steering
          try {
            const steered = drainSteering(app);
            const inj = formatSteeringInjection(steered);
            if (inj) {
              workingMessages.push(inj);
              console.log(TAG, 'injected steering', steered.length);
            }
          } catch (_) {}
        }
        const outcome = handleFinishCall({
          finishCall,
          actionsTaken,
          workingMessages,
          safeLogAction,
          counters,
          step,
          planState,
          isFastDebug,
          userText
        });
        if (outcome.blocked) {
          forceToolUse = true;
          continue;
        }
        if (outcome.finished) {
          // Plan mode: show Approve card — do not execute writes yet
          try {
            if (isPlanMode()) {
              const items = Array.isArray(planState?.items) ? planState.items : [];
              const summary = outcome.summary || '';
              if (summary) onChunk('\n\n' + summary);
              try { await AicodeHarness.finishRun(app, 'plan_awaiting_approval'); } catch (_) {}
              await finalizeLiveUI(app, actionsTaken, planState);
              showPlanApproveCard(app, { summary, items });
              return { actions: actionsTaken, filesHandled: true, planAwaitingApproval: true };
            }
          } catch (e) {
            console.warn(TAG, 'plan approve card', e);
          }
          // Only mark plan complete if every step is already done — never invent ticks
          try { forceCompletePlan(app, planState); } catch (_) {}
          if (outcome.summary) onChunk('\n\n' + outcome.summary);
          await finalizeLiveUI(app, actionsTaken, planState);
          try { scheduleFollowUps(app); } catch (_) {}
          try { logRunEnd(runTrace, 'finish_task'); } catch (_) {}
          return { actions: actionsTaken, filesHandled: true };
        }
      }

      const heldNote = HeldWrites.contextNote(app);
      if (heldNote) {
        responses.push({
          functionResponse: { name: 'held_writes_status', id: 'held-status', response: { success: true, message: heldNote } }
        });
      }
      try {
        for (const r of responses) {
          const fr = r?.functionResponse;
          if (fr?.name) noteToolEvidence(app, fr.name, fr.response || {}, {});
        }
      } catch (_) {}
      workingMessages.push({ role: 'user', content: responses });
      try {
        
      // No-progress after tool results
      try {
        const toolResults = responses.map(r => r?.functionResponse?.response || r?.result || r);
        const npRes = noteToolResults(noProgress, step, functionCalls, toolResults);
        if (npRes.stuck && npRes.nudge) {
          workingMessages.push({ role: 'user', content: [{ text: npRes.nudge }] });
          if (npRes.forceFinish) {
            try { await AicodeHarness.finishRun(app, 'no_progress'); } catch (_) {}
            try {
              const { eventForAgentStop } = await import('../../utils/message/StopReason.js');
              const { pushChatEvent } = await import('../../ui/chatInput/SlashCommands.js');
              const ev = eventForAgentStop(npRes.reason || 'no_progress');
              if (ev) await pushChatEvent(app, ev);
              console.warn('[AgentLoop] forceFinish after tools', npRes.reason, npRes);
            } catch (_) {}
            await finalizeLiveUI(app, actionsTaken, planState);
            try { logRunEnd(runTrace, npRes.reason || 'no_progress'); } catch (_) {}
            return { actions: actionsTaken, filesHandled: true, stoppedReason: npRes.reason || 'no_progress' };
          }
          forceToolUse = true;
        }
      } catch (_) {}

const steered = drainSteering(app);
        const inj = formatSteeringInjection(steered);
        if (inj) {
          workingMessages.push(inj);
          console.log(TAG, 'injected steering', steered.length);
        }
      } catch (_) {}

      // Gentle guidance on write errors (no destructive forceToolWritePass)
      const hadFailedWrite = responses.some(r =>
        ['write', 'str_replace', 'edit_file_lines', 'create_or_update_file'].includes(r.functionResponse?.name) &&
        (r.functionResponse?.response?.error || r.functionResponse?.response?.blocked)
      );
      if (hadFailedWrite) {
        counters.writeFailCount++;
        const lastErr = responses
          .map(r => r.functionResponse?.response?.error)
          .filter(Boolean)
          .join(' | ');

        let recoveryHint = `[SYSTEM: Tool call failed (${lastErr}). Follow the error instructions carefully.]`;
        if (/READ-BEFORE-EDIT/i.test(lastErr)) {
          recoveryHint = `[SYSTEM: You MUST call 'read' on the target file first before calling 'str_replace' or 'edit_file_lines'.]`;
        } else if (/ANTI-DATA-LOSS/i.test(lastErr)) {
          recoveryHint = `[SYSTEM: 'write' is forbidden on existing files. Call 'read' to view the file, then use 'str_replace' or 'edit_file_lines' to patch only the needed lines.]`;
        } else if (/could not find that 'search' snippet/i.test(lastErr)) {
          recoveryHint = `[SYSTEM: 'str_replace' search block did not match. Either call 'read' on the target lines to get the exact text, or use 'edit_file_lines' with { path, start_line, end_line, new_content }.]`;
        }
        workingMessages.push({ role: 'user', content: [{ text: recoveryHint }] });
        continue;
      }

      // Circuit-break repeated "File not found" reads (Flash Lite loops burn RPM)
      const notFoundReads = responses.filter(r =>
        ['read', 'read_file'].includes(r.functionResponse?.name) &&
        /File not found/i.test(String(r.functionResponse?.response?.error || ''))
      );
      if (notFoundReads.length) {
        counters.pathFailCount = (counters.pathFailCount || 0) + notFoundReads.length;
        if (counters.pathFailCount >= 2) {
          const suggestions = notFoundReads
            .map(r => (r.functionResponse?.response?.suggestions || []).join(', '))
            .filter(Boolean);
          workingMessages.push({
            role: 'user',
            content: [{
              text: `[SYSTEM: STOP guessing paths. ${counters.pathFailCount} file-not-found errors. ` +
                `Call list_directory with path="." ONCE, then read using the exact relative paths from the listing` +
                (suggestions.length ? ` (hints: ${suggestions.slice(0, 3).join(' | ')})` : '') +
                `. Do NOT retry the same missing path.]`
            }]
          });
        }
        if (counters.pathFailCount >= 5) {
          console.warn(TAG, 'Stopping agent — repeated path failures');
          await finalizeLiveUI(app, actionsTaken, planState);
          return { actions: actionsTaken, filesHandled: false, pathFailures: true };
        }
      } else if (responses.some(r =>
        ['read', 'read_file'].includes(r.functionResponse?.name) &&
        r.functionResponse?.response?.success
      )) {
        counters.pathFailCount = 0;
      }

      // M3: phase machine (explore → implement → force_write → finalize)
      const isExplorationOnly = functionCalls.every(f =>
        ['read', 'read_file', 'glob', 'grep', 'list_directory', 'outline', 'todo_write'].includes(f.name)
      );
      try {
        const mutatedNow = hasRealWrite(actionsTaken, app) || functionCalls.some(f =>
          /^(str_replace|edit_file_lines|write|create_or_update_file|search_replace_edit|apply_patch|multi_edit)$/.test(f?.name || '')
        );
        const phaseRes = notePhaseStep(phaseState, {
          step,
          functionCalls,
          hasMutated: mutatedNow
        });
        try {
          console.log('[PhaseController]', phaseLabel(phaseState), phaseRes);
          if (app.chatHandler?.liveUI?.setPhaseLabel) {
            app.chatHandler.liveUI.setPhaseLabel(phaseLabel(phaseState));
          }
        } catch (_) {}

        if (phaseRes.inject) {
          workingMessages.push({
            role: 'user',
            content: [{ text: phaseRes.inject }]
          });
        }
        if (phaseRes.forceToolUse) {
          forceToolUse = true;
          try { ToolRegistry.loadTools(app, ['write', 'str_replace', 'edit_file_lines']); } catch (_) {}
        }
        if (phaseRes.allowlist) {
          app._agentForceAllowlist = phaseRes.allowlist;
        }

        // Optional dedicated force-write pass (once)
        if (phaseRes.runForceWritePass && !counters.forceWritePassDone) {
          counters.forceWritePassDone = true;
          try {
            const { forceToolWritePass } = await import('./AgentForceWritePass.js');
            const fw = await forceToolWritePass(
              app, config, tools, apiMessages, workingMessages,
              onChunk, actionsTaken, safeLogAction, planState
            );
            if (fw?.ok || hasRealWrite(actionsTaken, app)) {
              phaseState.mutated = true;
              phaseState.phase = PHASE.IMPLEMENT;
              forceToolUse = false;
            }
          } catch (e) {
            console.warn(TAG, 'forceToolWritePass', e?.message || e);
          }
        }

        // Graceful finalize — tools off, one summary turn, clear stop event
        if (phaseRes.finalize && !counters.phaseFinalizeDone) {
          counters.phaseFinalizeDone = true;
          try {
            const { eventForAgentStop } = await import('../../utils/message/StopReason.js');
            const { pushChatEvent } = await import('../../ui/chatInput/SlashCommands.js');
            const why = phaseRes.reason || 'explore_budget';
            const ev = eventForAgentStop(why) || eventForAgentStop('phase_finalize');
            if (ev) await pushChatEvent(app, ev);
          } catch (_) {}
          try {
            // One tool-less completion message
            const sumOpts = {
              apiKey: config.apiKeyName ? ConfigManager.get(config.apiKeyName) : null,
              model: config.modelKeyName ? ConfigManager.get(config.modelKeyName) : null,
              messages: workingMessages,
              signal: app.currentRequestController?.signal,
              tools: [],
              forceToolUse: false,
              disableThinking: true,
              maxOutputTokensOverride: 1024
            };
            if (config?.handler?.generateStream) {
              await config.handler.generateStream(sumOpts, app, onChunk);
            }
          } catch (e) {
            console.warn(TAG, 'phase finalize summary', e?.message || e);
          }
          try { await AicodeHarness.finishRun(app, phaseRes.reason || 'explore_budget'); } catch (_) {}
          try { logRunEnd(runTrace, phaseRes.reason || 'explore_budget'); } catch (_) {}
          await finalizeLiveUI(app, actionsTaken, planState);
          return {
            actions: actionsTaken,
            filesHandled: hasRealWrite(actionsTaken, app),
            stoppedReason: phaseRes.reason || 'explore_budget'
          };
        }
      } catch (e) {
        console.warn(TAG, 'phase step', e?.message || e);
      }

      // M5: auto explore subagent once (parent avoids read-churn)
      try {
        if (
          shouldAutoExplore(app, { phaseState, userText, actionsTaken }) &&
          !counters.autoExploreStarted
        ) {
          counters.autoExploreStarted = true;
          const live = app.chatHandler?.liveUI;
          // Same id → Explore (running) upgrades in place to Explored (done)
          const autoExploreUiId = `auto-explore-${Date.now()}`;
          live?.logAgentAction?.({
            id: autoExploreUiId,
            verb: 'Explore',
            target: 'auto · project map',
            status: 'running',
            fcName: 'subagent'
          });
          const ae = await runAutoExplore(app, {
            userText,
            onProgress: ({ step }) => {
              try { live?.updateAssistantMessage?.(true, `Auto explore · step ${step}…`); } catch (_) {}
            }
          });
          live?.logAgentAction?.({
            id: autoExploreUiId,
            verb: 'Explored',
            target: 'auto · project map',
            status: ae?.success ? 'done' : 'error',
            fcName: 'subagent'
          });
          if (ae && !ae.skipped) {
            const inj = formatAutoExploreInjection(ae);
            if (inj) {
              // Plain user text only — NEVER functionResponse with synthetic id.
              // Mistral/OpenAI reject tool results whose tool_call_id was not in the prior assistant message
              // ("Unexpected tool call id auto-explore in tool results").
              workingMessages.push({
                role: 'user',
                content: [{ text: inj }]
              });
            }
            // Push parent toward implement
            forceToolUse = true;
            try { ToolRegistry.loadTools(app, ['write', 'str_replace', 'edit_file_lines']); } catch (_) {}
            app._agentForceAllowlist = MUTATE_ONLY_ALLOWLIST;
            if (phaseState) {
              phaseState.nudgeSent = true;
              phaseState.phase = PHASE.IMPLEMENT;
              phaseState.forceArmed = true;
            }
          }
        }
      } catch (e) {
        console.warn(TAG, 'auto explore', e?.message || e);
      }

      // legacy counter kept for other post-write logic
      if (isExplorationOnly && !hasRealWrite(actionsTaken, app)) {
        counters.exploreStreak++;
      } else if (!isExplorationOnly) {
        counters.exploreStreak = 0;
      }

      // —— OpenCode/Codex-style stop: plan complete + writes already done → stop exploring ——
      try {
        const wrote = hasRealWrite(actionsTaken, app);
        const planDone = !!(planState?.hasPlan && planState?.allDone);
        const postWriteExplore = wrote && isExplorationOnly;
        if (postWriteExplore) {
          counters.postWriteExplore = (counters.postWriteExplore || 0) + 1;
        } else if (!isExplorationOnly) {
          counters.postWriteExplore = 0;
        }

        // After edits, at most 2 more pure-read/grep steps — then force wrap-up
        if (wrote && (planDone || (counters.postWriteExplore || 0) >= 2)) {
          if ((counters.postWriteExplore || 0) >= 2 || planDone) {
            workingMessages.push({
              role: 'user',
              content: [{
                text: planDone
                  ? '[SYSTEM: All plan steps are complete and file changes were applied. Call finish_task NOW with a short summary. Do not re-read or re-grep files.]'
                  : '[SYSTEM: You already applied file changes. Stop exploring. Call finish_task with a short summary of what changed, or apply one remaining fix if truly incomplete.]'
              }]
            });
            counters.autoCorrectCount = (counters.autoCorrectCount || 0) + 1;
            // Hard stop after nudge was already given twice post-write
            if ((counters.postWriteExplore || 0) >= 4 || (planDone && (counters.postWriteExplore || 0) >= 2)) {
              console.log(TAG, 'Stopping agent loop — plan done / excess post-write exploration');
              try { forceCompletePlan(app, planState); } catch (_) {}
              try { await AicodeHarness.finishRun(app, 'done'); } catch (_) {}
              await finalizeLiveUI(app, actionsTaken, planState);
              return { actions: actionsTaken, filesHandled: true };
            }
          }
        }
      } catch (_) {}
    }
    try { logRunEnd(runTrace, 'max_steps'); } catch (_) {}


    try { await AicodeHarness.finishRun(app, 'done'); } catch (_) {}
    await finalizeLiveUI(app, actionsTaken, planState);
    return { actions: actionsTaken, filesHandled: true };
  }
}