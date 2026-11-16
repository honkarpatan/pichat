/**
 * PiAgentRunner — entry point of the Pi engine.
 *
 * Same signature as AgentRunner.route(app, config, modelType, apiMessages, onChunk),
 * so ApiRouter can hand the turn to Pi with one `if`.
 *
 * What it does NOT use from the default agent: AgentLoop, PhaseController,
 * NoProgressGuard, force-write passes, plan nudges, TaskIntent, ModelProfiles.
 *
 * What it reuses (plumbing, so every existing feature keeps working):
 *   tools + permissions/undo/audit/hooks/UI rows : ToolRegistry, executeAndLogTool
 *   queues                                       : SteeringQueue
 *   compaction + evidence                        : Compaction, FileKnowledge
 *   run bookkeeping                              : AicodeHarness, finalizeLiveUI
 *   plan mode                                    : PlanMode
 */
import { ConfigManager } from '../utils/ConfigManager.js';
import { executeAndLogTool } from '../agent/main/AgentToolExecution.js';
import { finalizeLiveUI } from '../agent/main/AgentFinish.js';
import { AicodeHarness } from '../agent/harness/AicodeHarness.js';
import { classifyTool, clearSessionGrants } from '../agent/harness/MutationGate.js';
import { AcodeFSAgent } from '../agent/tools/AcodeFSAgent.js';
import { isPlanMode, showPlanApproveCard } from '../agent/harness/PlanMode.js';
import { runUserPromptSubmitHooks } from '../agent/harness/AgentHooks.js';
import { drainSteering, formatSteeringInjection, drainFollowUp, clearSteeringQueue } from '../agent/harness/SteeringQueue.js';
import { compactWorkingMessages } from '../agent/context/Compaction.js';
import { clearFileKnowledge, noteToolEvidence, formatWorkingNotes } from '../agent/context/FileKnowledge.js';
import { loadProjectInstructions } from '../agent/context/ProjectInstructions.js';
import { hasPseudoToolMarkup, parseXmlStyleToolCalls, stripPseudoToolMarkup } from '../utils/agent/PseudoToolParser.js';
import { runPiLoop } from './PiLoop.js';
import { readPiSettings } from './PiSettings.js';
import { selectPiToolDecls, toProviderTools, isGeminiLike } from './PiToolset.js';
import { buildPiSystemPrompt, PI_PLAN_MODE_NUDGE } from './PiSystemPrompt.js';

const TAG = '[PiAgent]';

/**
 * Gemini drops role:'system' messages and Mistral always prepends getSystemInstruction(app);
 * for both the Pi prompt travels through that function (hook in SystemPrompt.js, see
 * INTEGRATION.md). Every other provider (claude, bedrock, vertex, openai-compatible,
 * chatgpt, grok, ...) reads a role:'system' message from the transcript.
 */
const NO_SYSTEM_MESSAGE = new Set(['gemini', 'mistral']);

const MUTATING_RESULT_STRIP = new Set([
  'write', 'create_or_update_file', 'str_replace', 'search_replace_edit',
  'edit_file_lines', 'create_file_tree', 'apply_patch', 'multi_edit'
]);

const NOT_PARALLEL = new Set(['ask_user_question', 'subagent', 'todo_write']);

function textOfMessage(m) {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((c) => (typeof c === 'string' ? c : (c && c.text) || ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function lastUserText(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].role === 'user') {
      const t = textOfMessage(msgs[i]);
      if (t) return t;
    }
  }
  return '';
}

function isToolCallMsg(m) {
  return !!(m && (m.role === 'model' || m.role === 'assistant') && Array.isArray(m.content) &&
    m.content.some((p) => p && (p.functionCall || p.type === 'tool_use')));
}
function isToolResultMsg(m) {
  return !!(m && m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p && p.functionResponse));
}

/**
 * Compaction can cut between a tool call and its result. An orphan tool result makes
 * OpenAI-style APIs answer 400, so drop any result whose call did not survive.
 */
export function repairToolPairs(messages, baseCount) {
  const out = messages.slice(0, baseCount + 1);
  for (let i = baseCount + 1; i < messages.length; i++) {
    const m = messages[i];
    const prev = out[out.length - 1];
    if (isToolResultMsg(m) && !isToolCallMsg(prev)) continue;
    out.push(m);
  }
  return out;
}

function applyTodo(app, planState, fc) {
  const raw = Array.isArray(fc.args?.items) ? fc.args.items : [];
  const items = raw
    .map((it) => {
      if (typeof it === 'string') return { text: it.trim(), status: 'pending' };
      const text = String(it?.text || it?.task || it?.content || '').trim();
      if (!text) return null;
      let s = String(it.status || 'pending').toLowerCase().replace(/[\s-]+/g, '_');
      if (['completed', 'complete', 'finished'].includes(s)) s = 'done';
      if (['running', 'active', 'doing'].includes(s)) s = 'in_progress';
      if (!['pending', 'in_progress', 'done'].includes(s)) s = 'pending';
      return { text, status: s };
    })
    .filter((x) => x && x.text);
  let seenActive = false;
  for (const it of items) {
    if (it.status === 'in_progress') {
      if (seenActive) it.status = 'pending';
      seenActive = true;
    }
  }
  planState.hasPlan = items.length > 0;
  planState.items = items;
  planState.allDone = items.length > 0 && items.every((i) => i.status === 'done');
  try { app.chatHandler?.liveUI?.logPlanUpdate?.(items); } catch (_) {}
  return { success: true, items };
}

function slimForModel(name, r) {
  if (r == null) return { success: true };
  if (typeof r !== 'object') return { result: r };
  const o = { ...r };
  delete o.oldContent;
  delete o.newContent;
  if (MUTATING_RESULT_STRIP.has(name)) delete o.content;
  return o;
}

export class PiAgentRunner {
  /**
   * @returns {Promise<object>} superset of what the default runner returns, so the
   *          caller (ChatSendFlow) can read whichever fields it expects.
   */
  static async route(app, config, modelType, apiMessages, onChunk) {
    const settings = readPiSettings();
    const signal = app.currentRequestController ? app.currentRequestController.signal : null;
    const conversationId = String(app.currentConversationIndex ?? '');
    const actionsTaken = [];
    const planState = { hasPlan: false, allDone: false, nudged: false, items: [], justPlanned: false };
    const emit = typeof onChunk === 'function' ? onChunk : () => {};
    const safeLogAction = (a) => {
      try { app.chatHandler?.liveUI?.logAgentAction?.(a); }
      catch (e) { console.warn(TAG, 'logAgentAction', e?.message || e); }
    };

    // ---- tools ------------------------------------------------------------------
    const decls = selectPiToolDecls(app, settings.toolProfile);
    if (!decls.length) throw new Error('Pi: no tools are registered for this model/profile.');
    const allowed = new Set(decls.map((d) => d.name));
    const tools = toProviderTools(modelType, config, decls);
    const geminiLike = isGeminiLike(modelType, config);

    // ---- system prompt ------------------------------------------------------------
    let projectText = '';
    try { projectText = (await loadProjectInstructions()).text || ''; } catch (_) {}
    const planMode = isPlanMode();
    const systemPrompt = buildPiSystemPrompt({
      app,
      decls,
      projectText,
      planNudge: planMode ? PI_PLAN_MODE_NUDGE : '',
      extra: settings.extraPrompt
    });
    app._piSystemPrompt = systemPrompt;

    // ---- transcript ---------------------------------------------------------------
    const base = (Array.isArray(apiMessages) ? apiMessages : []).map((m) => ({ ...m }));
    const transcript = [];
    const routeKey = String(modelType).toLowerCase();
    const baseKey = String(config?.baseProvider || '').toLowerCase();
    if (!NO_SYSTEM_MESSAGE.has(routeKey) && !NO_SYSTEM_MESSAGE.has(baseKey)) {
      transcript.push({ role: 'system', content: systemPrompt });
    }
    transcript.push(...base);
    try {
      const { injectTexts } = await runUserPromptSubmitHooks(lastUserText(base));
      if (injectTexts && injectTexts.length) {
        transcript.push({ role: 'user', content: [{ text: `[Project hook]\n${injectTexts.join('\n')}` }] });
      }
    } catch (_) {}
    const baseCount = transcript.length;

    // ---- run bookkeeping ----------------------------------------------------------
    AicodeHarness.startRun(app, { conversationId });
    try {
      const { FileChangeHistory } = await import('../utils/agent/FileChangeHistory.js');
      FileChangeHistory.beginBatch(app, { label: 'pi-run' });
    } catch (_) {}
    clearFileKnowledge(app);
    try { AcodeFSAgent.resetTurnReadTracker(); } catch (_) {} // Read-Before-Edit guard is per turn
    try { clearSessionGrants(app); } catch (_) {}
    try { clearSteeringQueue(app); } catch (_) {}
    try { app._autoExploreDone = false; } catch (_) {}
    app._agentRuntime = { config, modelType, handler: config.handler }; // needed by SubAgentRunner
    app._piActive = true;

    // ---- visible text with turn separators ------------------------------------------
    let inThink = false;
    let emittedText = false;
    let lastChar = '';
    let turnHasText = false;
    let overrideFinal = '';

    const writeVisible = (chunk) => {
      let c = String(chunk == null ? '' : chunk);
      if (!c) return;
      if (hasPseudoToolMarkup(c)) c = stripPseudoToolMarkup(c);
      if (!c) return;
      const tag = c.trim().toLowerCase();
      if (tag === '<think>' || tag === '<thinking>') { inThink = true; emit(c); return; }
      if (tag === '</think>' || tag === '</thinking>') { inThink = false; emit(c); return; }
      if (!inThink && !turnHasText) {
        turnHasText = true;
        if (emittedText && lastChar && lastChar !== '\n') emit('\n\n');
      }
      emit(c);
      if (!inThink) { emittedText = true; lastChar = c.slice(-1); }
    };

    // ---- one LLM turn ----------------------------------------------------------------
    const streamTurn = async ({ messages, turn }) => {
      turnHasText = false;
      const options = {
        apiKey: config.apiKeyName ? ConfigManager.get(config.apiKeyName) : null,
        model: config.modelKeyName ? ConfigManager.get(config.modelKeyName) : null,
        messages,
        signal,
        tools,
        forceToolUse: false // Pi never forces a tool call
      };
      const res = (await config.handler.generateStream(options, app, writeVisible)) || {};
      if (signal && signal.aborted) {
        const ae = new Error('Aborted'); ae.name = 'AbortError'; throw ae;
      }
      if (res.error) throw new Error(typeof res.error === 'string' ? res.error : (res.error.message || 'Provider error'));
      let functionCalls = Array.isArray(res.functionCalls) ? res.functionCalls.filter((f) => f && f.name) : [];
      let rawParts = Array.isArray(res.rawParts) ? res.rawParts.slice() : [];
      let text = rawParts
        .filter((p) => p && typeof p.text === 'string' && p.type !== 'thinking')
        .map((p) => p.text)
        .join('');

      // models that dump <function=...> markup as text instead of native tool calls
      if (!functionCalls.length && hasPseudoToolMarkup(text)) {
        const recovered = parseXmlStyleToolCalls(text);
        if (recovered.length) {
          functionCalls = recovered;
          text = stripPseudoToolMarkup(text);
          rawParts = [...(text ? [{ text }] : []), ...recovered.map((fc) => ({ functionCall: fc }))];
        }
      }

      if (!functionCalls.length && !text.trim()) {
        if (res.blockReason) throw new Error(`Provider blocked the response (${res.blockReason}).`);
        const fr = String(res.finishReason || '').toLowerCase();
        if (fr === 'length' || fr === 'max_tokens') {
          throw new Error('Output was cut off by the token limit before any content. Raise max tokens or shorten the context.');
        }
      }

      // stable ids so results match calls (Gemini matches by order/name, keep ids off it)
      if (!geminiLike) {
        functionCalls.forEach((fc, i) => { if (!fc.id) fc.id = `pi_${turn}_${i}`; });
        let k = 0;
        for (const p of rawParts) {
          if (p && p.functionCall) {
            const fc = functionCalls[k++];
            if (fc && !p.functionCall.id) p.functionCall.id = fc.id;
          }
        }
      }

      const fr = String(res.finishReason || '').toLowerCase();
      return {
        text,
        functionCalls,
        rawParts,
        truncated: fr === 'length' || fr === 'max_tokens'
      };
    };

    // ---- one tool call -----------------------------------------------------------------
    const runTool = async (fc, { turn, index }) => {
      const name = fc.name;

      if (fc.args && fc.args._parseError) {
        const why = fc.args._truncated
          ? 'The tool arguments were cut off (output limit) so nothing was executed. Retry with a smaller edit (str_replace/edit_file_lines on one section).'
          : 'The tool arguments were not valid JSON, so nothing was executed. Retry with valid arguments.';
        safeLogAction({ id: fc.id || `pi-${name}-${turn}-${index}`, verb: 'Failed', target: name, status: 'error', fcName: name, detail: why });
        return { response: { error: why, parseError: true }, isError: true };
      }

      if (name === 'finish_task' || name === 'answer_informational_query') {
        const msg = String(fc.args?.summary ?? fc.args?.message ?? fc.args?.response ?? fc.args?.text ?? '').trim();
        if (msg) { overrideFinal = msg; writeVisible(msg); }
        return { response: { success: true, note: 'Pi mode has no finish tool. Plain text replies end the run.' }, stop: true };
      }

      if (name === 'todo_write') {
        const r = applyTodo(app, planState, fc);
        return { response: r };
      }

      if (!allowed.has(name)) {
        return {
          response: { error: `Tool "${name}" is not available in Pi mode. Available: ${[...allowed].join(', ')}` },
          isError: true
        };
      }

      const actionId = fc.id || `pi-${name}-${turn}-${index}`;
      const { toolResult } = await executeAndLogTool({ app, fc, actionId, safeLogAction, actionsTaken });
      try { noteToolEvidence(app, name, toolResult, fc.args || {}); } catch (_) {}
      return {
        response: slimForModel(name, toolResult),
        isError: !!(toolResult && (toolResult.error || toolResult.rejected))
      };
    };

    // ---- queues ----------------------------------------------------------------------------
    const getSteering = async () => {
      const texts = drainSteering(app);
      const msg = formatSteeringInjection(texts);
      return msg ? [msg] : [];
    };
    const getFollowUp = settings.followUpMode === 'inloop'
      ? async () => drainFollowUp(app).map((t) => ({ role: 'user', content: [{ text: t }] }))
      : async () => [];

    // ---- context management ------------------------------------------------------------------
    const transformContext = async (messages) => {
      const r = compactWorkingMessages(messages, baseCount, {
        tokenBudget: settings.contextBudget,
        keepTail: 12,
        maxExtraMsgs: 60,
        workingNotes: formatWorkingNotes(app, 1800)
      });
      if (!r.compacted) return messages;
      console.log(TAG, 'compacted', r.beforeTokens, '→', r.afterTokens);
      return repairToolPairs(r.messages, baseCount);
    };

    // ---- go -------------------------------------------------------------------------------------
    let status = 'done';
    let planAwaiting = false;
    let planSummary = '';
    let stopEventReason = null;
    try {
      const result = await runPiLoop({
        messages: transcript,
        streamTurn,
        runTool,
        signal,
        getSteering,
        getFollowUp,
        transformContext,
        maxTurns: settings.maxTurns,
        toolExecution: settings.toolExecution,
        isParallelSafe: (n) => classifyTool(n) === 'none' && !NOT_PARALLEL.has(n),
        isMutating: (n) => classifyTool(n) !== 'none',
        maxIdenticalCalls: settings.maxIdenticalCalls,
        onEvent: (e) => {
          if (e.type === 'turn_end') {
            AicodeHarness.checkpoint(app, { step: e.turn, meta: { engine: 'pi' } }).catch(() => {});
          }
        }
      });

      if (!result.anyOutput && !overrideFinal) {
        throw new Error('The model returned an empty response.');
      }

      const finalText = overrideFinal || result.finalText || '';
      console.log(TAG, 'finished', { turns: result.turns, reason: result.reason, actions: actionsTaken.length });

      if (planMode) {
        planAwaiting = true;
        planSummary = finalText;
        status = 'plan_awaiting_approval';
      }

      const stopReason = result.reason === 'done' ? null : result.reason;
      stopEventReason = stopReason;
      return {
        filesHandled: true,
        planAwaitingApproval: planAwaiting,
        engine: 'pi',
        finished: true,
        summary: finalText,
        text: finalText,
        actions: actionsTaken,
        actionsTaken,
        functionCalls: [],
        rawParts: finalText ? [{ text: finalText }] : [],
        stopReason,
        stoppedReason: stopReason || undefined,
        reason: result.reason,
        turns: result.turns
      };
    } catch (e) {
      status = e && e.name === 'AbortError' ? 'aborted' : 'error';
      throw e; // ApiKeyManager.runWithFailover decides whether to try the next key
    } finally {
      app._piActive = false;
      app._piSystemPrompt = null;
      try { await AicodeHarness.finishRun(app, status); } catch (_) {}
      try { await finalizeLiveUI(app, actionsTaken, planState); } catch (e) { console.warn(TAG, 'finalizeLiveUI', e?.message || e); }
      if (stopEventReason) {
        try {
          const { eventForAgentStop } = await import('../utils/message/StopReason.js');
          const { pushChatEvent } = await import('../ui/chatInput/SlashCommands.js');
          const ev = eventForAgentStop(stopEventReason);
          if (ev) await pushChatEvent(app, ev);
        } catch (_) {}
      }
      if (planAwaiting) {
        try { showPlanApproveCard(app, { summary: planSummary, items: planState.items }); } catch (e) { console.warn(TAG, 'plan card', e?.message || e); }
      }
    }
  }
}
