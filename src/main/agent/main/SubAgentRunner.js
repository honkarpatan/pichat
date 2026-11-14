/**
 * Child agent loop (Pi/Official subagent pattern — our harness).
 * explore = read-only tools; general = can mutate but no nested subagent.
 */
import { ConfigManager } from '../../utils/ConfigManager.js';
import { ToolRegistry, CORE_TOOL_NAMES, DEFERRED_TOOL_NAMES } from '../../core/tools/ToolRegistry.js';
import { truncateToolResultForModel, toolResultMaxChars } from '../harness/ToolResultBudget.js';
import { isFillerInfoMessage, isSubstantialInfoMessage, extractInfoMessage } from '../../utils/agent/AnswerInfoFilter.js';

const TAG = '[SubAgent]';
const MAX_REPORT = 16000;
const EXPLORE_STEPS = 20;
const GENERAL_STEPS = 25;

const EXPLORE_TOOLS = new Set([
  'read', 'list_directory', 'glob', 'grep', 'outline',
  'answer_informational_query', 'web_search', 'fetch_content',
  'finish_task'
]);

const PARENT_ONLY = new Set(['subagent', 'ask_user_question', 'todo_write']);

function filterToolSchemas(allSchemas, type) {
  const list = Array.isArray(allSchemas) ? allSchemas : [];
  if (type === 'explore') {
    return list.filter(t => {
      const n = t.name || t.function?.name;
      return EXPLORE_TOOLS.has(n);
    });
  }
  // general: everything except parent-only
  return list.filter(t => {
    const n = t.name || t.function?.name;
    return n && !PARENT_ONLY.has(n);
  });
}

function lowerTypes(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const o = Array.isArray(obj) ? [...obj] : { ...obj };
  if (typeof o.type === 'string') o.type = o.type.toLowerCase();
  if (o.properties) {
    o.properties = { ...o.properties };
    for (const k of Object.keys(o.properties)) o.properties[k] = lowerTypes(o.properties[k]);
  }
  if (o.items) o.items = lowerTypes(o.items);
  return o;
}

function schemasForProvider(modelType, decls) {
  if (modelType === 'gemini') {
    return [{ functionDeclarations: decls }];
  }
  if (modelType === 'claude') {
    return decls.map(d => ({
      name: d.name,
      description: d.description,
      input_schema: lowerTypes(JSON.parse(JSON.stringify(d.parameters || { type: 'object', properties: {} })))
    }));
  }
  return decls.map(d => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description,
      parameters: lowerTypes(JSON.parse(JSON.stringify(d.parameters || { type: 'object', properties: {} })))
    }
  }));
}

function extractText(result) {
  if (!result) return '';
  const parts = result.rawParts || [];
  return parts.map(p => p.text || '').join('').trim();
}

/**
 * @param {object} opts
 * @param {object} opts.app
 * @param {'explore'|'general'} opts.type
 * @param {string} opts.task
 * @param {function} [opts.onProgress]
 * @returns {Promise<{ success: boolean, report: string, steps: number, actions: number }>}
 */
function buildStructured(anchors, notes, report) {
  const fromReport = (() => {
    try {
      const m = String(report || '').match(/```json\s*([\s\S]*?)```/i);
      if (m) return JSON.parse(m[1]);
    } catch (_) {}
    return null;
  })();
  if (fromReport && (fromReport.anchors || fromReport.notes)) return fromReport;
  return {
    anchors: (anchors || []).slice(0, 30),
    notes: (notes || []).slice(0, 20),
    editTargets: []
  };
}

export async function runSubAgent({ app, type = 'explore', task, onProgress, agentDef = null }) {
  const runtime = app._agentRuntime;
  if (!runtime?.config?.handler?.generateStream) {
    return { success: false, report: 'Subagent unavailable: no agent runtime/handler', steps: 0, actions: 0 };
  }

  // Custom agent definition overrides type/tools/prompt/model
  const custom = agentDef && typeof agentDef === 'object' ? agentDef : null;
  let kind = type === 'general' ? 'general' : 'explore';
  if (custom) {
    kind = custom.readonly ? 'explore' : 'general';
  }
  let maxSteps = kind === 'explore' ? EXPLORE_STEPS : GENERAL_STEPS;
  if (custom?.maxSteps) maxSteps = Math.min(40, Math.max(3, custom.maxSteps));
  const { config, modelType } = runtime;
  const signal = app.currentRequestController?.signal;

  // Isolate loaded tools for child
  const parentLoaded = new Set(app._agentLoadedTools || []);
  if (kind === 'explore') {
    app._agentLoadedTools = new Set(); // only core explore set via filter
  } else {
    // general may use deferred — start clean, tool_search can load
    app._agentLoadedTools = new Set(parentLoaded);
  }

  const allDecls = ToolRegistry._allDecls
    ? ToolRegistry._allDecls(app)
    : [];
  let decls = filterToolSchemas(allDecls, kind);
  if (custom?.tools && Array.isArray(custom.tools) && custom.tools.length) {
    const allow = new Set(custom.tools.map(String));
    allow.add('finish_task');
    decls = (allDecls || []).filter(d => allow.has(d.name));
    // still strip parent-only
    decls = decls.filter(d => d.name && !PARENT_ONLY.has(d.name));
  }
  // Ensure finish_task present
  if (!decls.some(d => d.name === 'finish_task')) {
    decls = [...decls, {
      name: 'finish_task',
      description: 'Call when the subagent task is done with a report in summary.',
      parameters: {
        type: 'OBJECT',
        properties: { summary: { type: 'STRING' } },
        required: ['summary']
      }
    }];
  }

  const tools = schemasForProvider(modelType, decls);
  const exploreAnchors = [];
  const exploreNotes = [];


  let systemTask;
  if (custom?.systemPrompt) {
    systemTask =
      `[SUBAGENT custom: ${custom.id || custom.name}]\n` +
      `${custom.systemPrompt}\n\n` +
      `Task: ${task}\n` +
      (custom.readonly
        ? `READ ONLY — do not write, delete, or run shell.\n`
        : `You may use allowed tools. Do not call subagent.\n`) +
      `When done, call finish_task with a clear report.`;
  } else {
    systemTask = kind === 'explore'
      ? `[SUBAGENT explore — READ ONLY]\nTask: ${task}\n` +
        `Use only read/list/glob/grep (and web if available). Do NOT write, delete, or run shell.\n` +
        `When done, call finish_task with a clear report of findings.`
      : `[SUBAGENT general]\nTask: ${task}\n` +
        `You may use tools to complete the task. Do not call subagent.\n` +
        `When done, call finish_task with a summary of what you did.`;
  }

  let messages = [
    { role: 'user', content: [{ text: systemTask }] }
  ];

  let report = '';
  let steps = 0;
  let actions = 0;
  const findings = [];

  try {
    for (let step = 1; step <= maxSteps; step++) {
      if (signal?.aborted) {
        report = report || 'Subagent aborted.';
        break;
      }
      steps = step;
      onProgress?.({ step, kind, task });

      // Multi-model routing: custom agent model > explore override > parent
      let modelId = config.modelKeyName ? ConfigManager.get(config.modelKeyName) : null;
      let apiKey = config.apiKeyName ? ConfigManager.get(config.apiKeyName) : null;
      try {
        if (custom?.model && String(custom.model).trim()) {
          modelId = String(custom.model).trim();
          console.log(TAG, 'custom agent model →', modelId);
        } else if (kind === 'explore') {
          const exploreModel = ConfigManager.get('agentExploreModel');
          if (exploreModel && String(exploreModel).trim()) {
            modelId = String(exploreModel).trim();
            console.log(TAG, 'explore model override →', modelId);
          }
        }
      } catch (_) {}

      const options = {
        apiKey,
        model: modelId,
        messages,
        signal,
        tools,
        forceToolUse: true,
        disableThinking: true,
        maxOutputTokensOverride: 4096
      };

      let result;
      try {
        result = await config.handler.generateStream(options, app, () => {});
      } catch (e) {
        if (e?.name === 'AbortError' || signal?.aborted) break;
        const msg = e?.message || String(e);
        console.error(TAG, 'generateStream', msg, e);
        findings.push(`Error on step ${step}: ${msg}`);
        // Network blip: return what we have instead of empty report
        if (/failed to fetch|network|429|rate/i.test(msg) && findings.length > 1) {
          report = (
            `Subagent (${kind}) stopped early (${msg}). Partial findings:\n` +
            findings.slice(0, -1).join('\n')
          ).slice(0, MAX_REPORT);
          break;
        }
        break;
      }

      let functionCalls = result?.functionCalls || [];
      // Collapse answer_informational_query spam: keep at most one substantial message
      {
        const infos = functionCalls.filter(fc => fc.name === 'answer_informational_query');
        if (infos.length) {
          const others = functionCalls.filter(fc => fc.name !== 'answer_informational_query');
          let best = null;
          for (const fc of infos) {
            const msg = extractInfoMessage(fc);
            if (isSubstantialInfoMessage(msg)) {
              best = fc;
              break;
            }
            if (!best && msg && !isFillerInfoMessage(msg)) best = fc;
          }
          functionCalls = best ? [...others, best] : others;
          if (infos.length > 1) {
            console.log(TAG, 'collapsed answer_informational_query', { from: infos.length, kept: best ? 1 : 0 });
          }
        }
      }
      const textOut = extractText(result);
      if (textOut) findings.push(textOut.slice(0, 500));

      if (!functionCalls.length) {
        if (textOut) report = textOut;
        // nudge once
        if (step < maxSteps) {
          messages.push({ role: 'model', content: result?.rawParts || [{ text: textOut || ' ' }] });
          messages.push({
            role: 'user',
            content: [{ text: '[SYSTEM: Call a tool or finish_task with your report.]' }]
          });
          continue;
        }
        break;
      }

      // Record model turn
      messages.push({ role: 'model', content: result.rawParts || functionCalls.map(fc => ({ functionCall: fc })) });
      const responses = [];

      for (const fc of functionCalls) {
        if (fc.name === 'finish_task') {
          report = String(fc.args?.summary || textOut || 'Done.').slice(0, MAX_REPORT);
          responses.push({
            functionResponse: { name: 'finish_task', id: fc.id, response: { success: true } }
          });
          messages.push({ role: 'user', content: responses });
          // restore parent tools
          app._agentLoadedTools = parentLoaded;
          return { success: true, structured: buildStructured(exploreAnchors, exploreNotes, report), report, steps, actions, type: kind };
        }

        // answer_informational_query: capture real report; skip filler (no UI / no spam findings)
        if (fc.name === 'answer_informational_query') {
          const msg = extractInfoMessage(fc);
          if (isFillerInfoMessage(msg)) {
            responses.push({
              functionResponse: {
                name: 'answer_informational_query',
                id: fc.id,
                response: { success: true, ignored: true, reason: 'filler' }
              }
            });
            continue;
          }
          if (isSubstantialInfoMessage(msg)) {
            report = msg.slice(0, MAX_REPORT);
            responses.push({
              functionResponse: {
                name: 'answer_informational_query',
                id: fc.id,
                response: { success: true, message: 'Report captured for parent.' }
              }
            });
            messages.push({ role: 'user', content: responses });
            app._agentLoadedTools = parentLoaded;
            return {
              success: true,
              structured: buildStructured(exploreAnchors, exploreNotes, report),
              report,
              steps,
              actions,
              type: kind
            };
          }
          // Borderline text — keep as soft finding, do not end yet
          if (msg) findings.push(msg.slice(0, 400));
          responses.push({
            functionResponse: {
              name: 'answer_informational_query',
              id: fc.id,
              response: { success: true, message: 'Noted.' }
            }
          });
          continue;
        }

        if (PARENT_ONLY.has(fc.name) || (kind === 'explore' && !EXPLORE_TOOLS.has(fc.name))) {
          responses.push({
            functionResponse: {
              name: fc.name,
              id: fc.id,
              response: { error: `Tool "${fc.name}" not allowed in ${kind} subagent.` }
            }
          });
          continue;
        }

        actions++;
        let toolResult;
        try {
          toolResult = await ToolRegistry.executeTool(fc, app);
          toolResult = truncateToolResultForModel(toolResult, {
            maxChars: Math.min(6000, toolResultMaxChars(app)),
            toolName: fc.name
          });
        } catch (e) {
          toolResult = { error: e?.message || String(e) };
        }

        // M5: collect anchors for structured explore report
        try {
          if (kind === 'explore' && toolResult && !toolResult.error) {
            if (fc.name === 'read' || fc.name === 'read_file') {
              exploreAnchors.push({
                path: toolResult.pathRelative || toolResult.path || fc.args?.path || '',
                start: parseInt(String(toolResult.range || '').split('-')[0], 10) || fc.args?.start_line || 1,
                end: parseInt(String(toolResult.range || '').split('-')[1], 10) || fc.args?.end_line || undefined,
                why: 'read'
              });
            } else if (fc.name === 'outline') {
              for (const s of (toolResult.symbols || []).slice(0, 15)) {
                exploreAnchors.push({
                  path: toolResult.pathRelative || toolResult.path || fc.args?.path || '',
                  start: s.line,
                  end: s.line,
                  why: `${s.kind || ''} ${s.name || ''}`.trim()
                });
              }
            } else if (fc.name === 'grep' && toolResult.summary) {
              exploreNotes.push(String(toolResult.summary).slice(0, 200));
            }
          }
        } catch (_) {}
        const slim = toolResult && typeof toolResult === 'object' ? { ...toolResult } : toolResult;
        if (slim && typeof slim === 'object') {
          delete slim.oldContent;
          delete slim.newContent;
          if (slim.content && String(slim.content).length > 4000) {
            slim.content = String(slim.content).slice(0, 4000) + '\n…[truncated]';
          }
        }
        responses.push({
          functionResponse: { name: fc.name, id: fc.id, response: slim }
        });

        const snippet = typeof slim === 'object'
          ? (slim.error || slim.message || slim.summary || (slim.content ? String(slim.content).slice(0, 120) : fc.name))
          : String(slim).slice(0, 120);
        findings.push(`${fc.name}: ${snippet}`);
      }

      messages.push({ role: 'user', content: responses });

      // Keep child context small
      if (messages.length > 24) {
        messages = [messages[0], ...messages.slice(-16)];
      }
    }

    if (!report) {
      report = findings.length
        ? `Subagent (${kind}) ended after ${steps} steps.\n` + findings.slice(-12).join('\n')
        : `Subagent (${kind}) ended with no findings.`;
      report = report.slice(0, MAX_REPORT);
    }
  } finally {
    app._agentLoadedTools = parentLoaded;
  }

  return { success: true, structured: buildStructured(exploreAnchors, exploreNotes, report), report, steps, actions, type: kind };
}
