// src/main/agent/main/AgentForceWritePass.js
//
// Escalation pass: force the model to call a WRITE tool (tool_choice
// "required") when the normal loop stalled on prose-only or refused output.

import { ConfigManager } from '../../utils/ConfigManager.js';
import { hasPseudoToolMarkup, stripPseudoToolMarkup } from '../../utils/agent/PseudoToolParser.js';
import { executeAndLogTool } from './AgentToolExecution.js';
import { handleTodoWrite, PLAN_TOOL_NAME, looksLikeFixRequest } from './AgentPlanning.js';
import { hasRealWrite, hasDeliverableWrite } from './AgentFinish.js';

const TAG = '[AgentForceWritePass]';

const HIDDEN_BLOCK_RE = /^\[[A-Za-z][^\]\n]{0,80}\]/;

function stripHiddenBlocks(text) {
  const chunks = String(text || '').split(/\n\n+/).map(s => s.trim()).filter(Boolean);
  const real = chunks.filter(c => !HIDDEN_BLOCK_RE.test(c));
  return real.join('\n\n').trim();
}

function isPlaceholderDeliverable(content) {
  const s = String(content || '');
  if (s.length < 80) return true;
  const low = s.toLowerCase();
  const stubHints = [
    'welcome to acode',
    'your project is successfully initialized',
    'your workspace is ready',
    'acode project',
    'ready for development',
    'hello world',
    'welcome!</h1>',
    'welcome!</h1>'
  ];
  const hit = stubHints.some(h => low.includes(h));
  if (hit && s.length < 3500) return true;
  if (hit && !/blog|article|post|newsletter|sidebar|nav/i.test(s)) return true;
  return false;
}

function extractRealUserText(apiMessages) {
  const src = apiMessages || [];
  for (let i = src.length - 1; i >= 0; i--) {
    const m = src[i];
    if (m.role !== 'user') continue;
    if (Array.isArray(m.content)) {
      if (m.content.some(c => c.functionResponse)) continue;
      const raw = m.content.map(c => c.text || '').join('\n').trim();
      if (!raw) continue;
      const real = stripHiddenBlocks(raw) || raw;
      if (real && !HIDDEN_BLOCK_RE.test(real) && !/^\[SYSTEM/i.test(real)) return real;
    } else {
      const raw = String(m.content || '').trim();
      if (!raw) continue;
      const real = stripHiddenBlocks(raw) || raw;
      if (real && !HIDDEN_BLOCK_RE.test(real) && !/^\[SYSTEM/i.test(real)) return real;
    }
  }
  return '';
}

export async function forceToolWritePass(app, config, tools, apiMessages, workingMessages, onChunk, actionsTaken, safeLogAction, planState) {
  console.log(TAG, 'force tool write pass (tool_choice required)');
  safeLogAction?.({
    id: `force-tools-${Date.now()}`,
    verb: 'Tools',
    target: 'project files',
    status: 'done'
  });
  if (app.chatHandler?.liveUI?.updateAssistantMessage) {
    app.chatHandler.liveUI.updateAssistantMessage(true, 'Continuing with file updates…', 5000);
  }

  const { ToolRegistry } = await import('../../core/tools/ToolRegistry.js');
  
  let userText = extractRealUserText(apiMessages);
  if (!userText) userText = 'Create the requested project files.';

  const isFastDebug = looksLikeFixRequest(userText);
  const hadReadsBefore = (actionsTaken || []).some(a => a.fcName === 'read_file' || a.fcName === 'read' || /read/i.test(String(a.verb || '')));
  const isFixMode = (isFastDebug || hadReadsBefore);
  
  const forcedToolName = isFixMode ? 'str_replace' : ToolRegistry.primaryWriteToolName();
  
  // HARD: never expose read/grep/outline during force-write (fallback to full tools was the bug)
  const EDIT_NAMES = ['str_replace', 'edit_file_lines', 'search_replace_edit', 'write', 'create_or_update_file'];
  let writeTools = tools;

  function filterEditOnly(srcTools) {
    if (!Array.isArray(srcTools) || !srcTools.length) return null;
    if (srcTools[0]?.functionDeclarations) {
      const decls = (srcTools[0].functionDeclarations || []).filter(d => EDIT_NAMES.includes(d.name));
      return decls.length ? [{ functionDeclarations: decls }] : null;
    }
    if (srcTools[0]?.function) {
      const filtered = srcTools.filter(t => EDIT_NAMES.includes(t.function?.name));
      return filtered.length ? filtered : null;
    }
    if (srcTools[0]?.input_schema || srcTools[0]?.name) {
      const filtered = srcTools.filter(t => EDIT_NAMES.includes(t.name));
      return filtered.length ? filtered : null;
    }
    return null;
  }

  try {
    writeTools = filterEditOnly(tools);
    if (!writeTools) {
      try {
        writeTools = ToolRegistry.getGeminiWriteTools?.(app) || ToolRegistry.getStandardWriteTools?.(app) || null;
        writeTools = filterEditOnly(writeTools) || writeTools;
      } catch (_) {}
    }
    if (!writeTools) {
      // Last resort: keep forced names only from original if any
      writeTools = filterEditOnly(tools) || tools;
      console.warn(TAG, 'edit-only filter empty — check ToolRegistry write schemas');
    }
  } catch (e) {
    console.warn(TAG, 'write tool filter failed', e);
    writeTools = filterEditOnly(tools) || tools;
  }

  const writtenNames = [];
  for (const a of actionsTaken || []) {
    if (a.status === 'error' || a.status === 'rejected') continue;
    const path = String(a.fullPath || a.url || a.label || a.fcArgs?.path || '');
    const base = path.split('/').pop();
    if (base && !/\.(md)$/i.test(base)) writtenNames.push(base);
  }
  const pendingPlan = (planState?.items || [])
    .filter(it => it.status !== 'done')
    .map(it => `- [${it.status || 'pending'}] ${it.text || it.task || ''}`)
    .join('\n');
  const nextStep = (planState?.items || []).find(it => it.status === 'in_progress')
    || (planState?.items || []).find(it => it.status === 'pending' || !it.status);
  
  const nextHintText = nextStep
    ? `Next plan step only: "${nextStep.text || nextStep.task || ''}"`
    : 'Write the next missing deliverable for the user request (one file).';

const systemPrompt = isFixMode
    ? `[SYSTEM — Escalate to Safe Patching]
User request reminder:
${userText.slice(0, 1500)}

Already modified: ${writtenNames.length ? writtenNames.join(', ') : '(none yet)'}.
Do NOT call read, grep, outline, or list_directory. You already have file context. You MUST edit the code NOW. Do NOT rewrite the whole file. Do NOT use the 'write' tool for existing files!

CRITICAL INSTRUCTION:
If your previous 'str_replace' failed due to a snippet mismatch, DO NOT use 'str_replace' again! Instead, use the 'edit_file_lines' tool. It is 100% safe as it uses exact line numbers from your previous read output.`
    : `[SYSTEM — Escalate to File Write]
User request reminder:
${userText.slice(0, 1500)}

${nextHintText}
Already written this turn: ${writtenNames.length ? writtenNames.join(', ') : '(none yet)'}.
${pendingPlan ? `Remaining plan:\n${pendingPlan}\n` : ''}
Call write ONCE for the next incomplete step only. Match the user request; no generic starter/placeholder files.
FORBIDDEN: "Welcome to Acode", "project initialized", empty Hello World stubs. No markdown fences.`;

  const messages = [
    ...(workingMessages || []),
    { role: 'user', content: [{ text: systemPrompt }] }
  ];

  const forcedAllowed = ['str_replace', 'edit_file_lines', 'write', 'search_replace_edit'];

  const options = {
    apiKey: config.apiKeyName ? ConfigManager.get(config.apiKeyName) : null,
    model: config.modelKeyName ? ConfigManager.get(config.modelKeyName) : null,
    messages,
    signal: app.currentRequestController.signal,
    tools: writeTools || tools,
    forceToolUse: true,
    disableThinking: true,
    maxOutputTokensOverride: 8192,
    allowedFunctionNames: forcedAllowed
  };

  const safeChunk = (chunk) => {
    try {
      if (chunk && hasPseudoToolMarkup(String(chunk))) onChunk(stripPseudoToolMarkup(String(chunk)));
      else onChunk(chunk);
    } catch (_) { onChunk(chunk); }
  };
  
  let result;
  try {
    result = await config.handler.generateStream(options, app, safeChunk);
    
    if (app.currentRequestController && app.currentRequestController.signal && app.currentRequestController.signal.aborted) {
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
    }
  } catch (e) {
    console.error(TAG, 'force tool pass failed', e);
    return { ok: false, actions: actionsTaken, error: e?.message || String(e) };
  }

  let functionCalls = result?.functionCalls || [];
  let rawParts = result?.rawParts || [];

  // Drop any explore calls the provider still returned despite allowlist
  {
    const before = functionCalls.map(f => f?.name).filter(Boolean);
    functionCalls = functionCalls.filter(f => EDIT_NAMES.includes(f?.name));
    if (before.length && !functionCalls.length) {
      console.log(TAG, 'stripped non-edit calls from force pass', { before });
    }
  }
  
  if (!functionCalls.length) {
    if (result?.blockReason) {
      safeLogAction?.({ id: `force-blocked-${Date.now()}`, verb: 'Blocked', target: `Provider content filter (${result.blockReason})`, status: 'error' });
      return { ok: false, actions: actionsTaken, blockReason: result.blockReason, finishReason: result?.finishReason };
    }
    
    safeLogAction?.({ id: `force-retry-${Date.now()}`, verb: 'Retry', target: 'Lean single file write', status: 'done' });
    
    let leanTools = options.tools;
    try {
      if (Array.isArray(leanTools) && leanTools[0]?.functionDeclarations) {
        const decls = (leanTools[0].functionDeclarations || []).filter(d => forcedAllowed.includes(d.name));
        if (decls.length) leanTools = [{ functionDeclarations: decls }];
      } else if (Array.isArray(leanTools) && leanTools[0]?.function) {
        leanTools = leanTools.filter(t => forcedAllowed.includes(t.function?.name));
      }
    } catch (_) {}

    const leanSys = isFixMode
  ? `[SYSTEM: Do NOT call read, grep, outline, or list_directory. You already have file context. You MUST edit the code NOW. Call 'edit_file_lines' to replace code by exact line number. This is the safest way to avoid search mismatch errors. Do NOT use the 'write' tool!]`
  : `[SYSTEM: Call write ONCE for the NEXT incomplete plan step — not a random file.\n${nextHintText}\nAlready written: ${writtenNames.length ? writtenNames.join(', ') : '(none)'}. Build on those.\nUser request:\n${String(userText || '').slice(0, 1200)}\nFORBIDDEN: Welcome/Acode/Hello-World placeholders. One write only.]`;

    const leanOpts = {
      ...options,
      tools: leanTools,
      messages: [...(workingMessages || []), { role: 'user', content: [{ text: leanSys }] }],
      forceToolUse: true,
      disableThinking: true,
      maxOutputTokensOverride: 8192,
      allowedFunctionNames: forcedAllowed
    };
    
    try {
      result = await config.handler.generateStream(leanOpts, app, safeChunk);
      
      if (app.currentRequestController && app.currentRequestController.signal && app.currentRequestController.signal.aborted) {
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
      }
    } catch (e2) {
      console.error(TAG, 'lean retry failed', e2);
      return { ok: false, actions: actionsTaken, error: e2?.message || String(e2), finishReason: result?.finishReason };
    }
    
    functionCalls = result?.functionCalls || [];
    rawParts = result?.rawParts || [];
    
    if (!functionCalls.length) {
      if (result?.finishReason === 'MAX_TOKENS' && !result?.blockReason) {
        safeLogAction?.({ id: `force-retry2-${Date.now()}`, verb: 'Retry', target: 'Higher token budget', status: 'done' });
        const finalOpts = { ...leanOpts, maxOutputTokensOverride: 8192 };
        try {
          result = await config.handler.generateStream(finalOpts, app, safeChunk);
          
          if (app.currentRequestController && app.currentRequestController.signal && app.currentRequestController.signal.aborted) {
              const abortErr = new Error('Aborted');
              abortErr.name = 'AbortError';
              throw abortErr;
          }
        } catch (e3) {
          console.error(TAG, 'final high-budget retry failed', e3);
          return { ok: false, actions: actionsTaken, error: e3?.message || String(e3), finishReason: result?.finishReason };
        }
        functionCalls = result?.functionCalls || [];
        rawParts = result?.rawParts || [];
        functionCalls = functionCalls.filter(f => EDIT_NAMES.includes(f?.name));
      }
      if (!functionCalls.length) {
        return { ok: false, actions: actionsTaken, blockReason: result?.blockReason, finishReason: result?.finishReason || 'MAX_TOKENS' };
      }
    }
  }

  // Final hard filter — lean retries can still return read
  {
    const before = functionCalls.map(f => f?.name).filter(Boolean);
    functionCalls = (functionCalls || []).filter(f => EDIT_NAMES.includes(f?.name));
    if (before.length && before.some(n => !EDIT_NAMES.includes(n))) {
      console.log(TAG, 'final strip non-edit before execute', { before, after: functionCalls.map(f => f?.name) });
    }
  }
  if (!functionCalls.length) {
    console.log(TAG, 'force pass: no edit tool calls after strip — aborting pass');
    return { ok: false, actions: actionsTaken, reason: 'no_edit_tool_call' };
  }

  const responses = [];

  for (const fc of functionCalls) {
    if (fc.name === 'finish_task') continue;

    // NEVER execute explore tools in force-write pass
    if (!EDIT_NAMES.includes(fc.name) && fc.name !== PLAN_TOOL_NAME) {
      responses.push({
        functionResponse: {
          name: fc.name,
          id: fc.id,
          response: {
            success: false,
            skipped: true,
            error: `Tool "${fc.name}" blocked during force-write. Use str_replace or edit_file_lines.`
          }
        }
      });
      continue;
    }

    if (fc.name === PLAN_TOOL_NAME) {
      const planResp = await handleTodoWrite({ app, fc, safeLogAction, planState });
      if (planResp?.functionResponse) responses.push(planResp);
      else if (planResp) responses.push({ functionResponse: planResp });
      continue;
    }

    const actionId = fc.id || `ft-${fc.name}-${Date.now()}`;
    const { toolResult } = await executeAndLogTool({ app, fc, actionId, safeLogAction, actionsTaken });

    const aiContextResponse = toolResult && typeof toolResult === 'object' ? { ...toolResult } : toolResult;
    if (aiContextResponse && typeof aiContextResponse === 'object') {
      delete aiContextResponse.oldContent;
      delete aiContextResponse.newContent;
      if (['write', 'str_replace', 'create_or_update_file', 'edit_file_lines', 'search_replace_edit', 'create_file_tree'].includes(fc.name)) {
        delete aiContextResponse.content;
      }
    }
    responses.push({ functionResponse: { name: fc.name, id: fc.id, response: aiContextResponse } });
  }

  for (const a of actionsTaken || []) {
    const body = a.newContent != null ? a.newContent : '';
    if (body && isPlaceholderDeliverable(body)) {
      a.status = 'error';
      a.verb = 'Rejected stub';
      a.detail = 'Placeholder content ignored — does not match user request';
    }
  }

  const ok = hasDeliverableWrite(actionsTaken, app)
    || (actionsTaken || []).some(a => ['str_replace', 'edit_file_lines'].includes(a.fcName) && (a.status === 'success' || a.status === 'done'));
  if (ok) onChunk(isFixMode ? '\n\n✓ Patch applied safely.' : '\n\n✓ Files written via tools.');
  
  return { ok, actions: actionsTaken, responses, rawParts };
}