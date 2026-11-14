// OpenAI-compatible providers: OpenRouter, Groq, Together, Fireworks, DeepInfra, SiliconFlow
import { getSystemInstruction, SYSTEM_INSTRUCTION } from '../SystemPrompt.js';
import { modelSupportsNativeThink } from '../thinking/ThinkCapability.js';
import { providerFetch } from '../../utils/network/RateLimitRetry.js';
import { repairToolArgs } from '../../utils/agent/ToolArgsSalvage.js';
import { ConfigManager } from '../../utils/ConfigManager.js';

/** baseUrl + optional extra headers per ModelConfig type */
export const OPENAI_COMPAT_PROVIDERS = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    extraHeaders: () => ({
      'HTTP-Referer': 'https://acode.app',
      'X-Title': 'Acode AI Chat'
    })
  },
  groqcloud: {
    baseUrl: 'https://api.groq.com/openai/v1',
    extraHeaders: () => ({})
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    extraHeaders: () => ({})
  },
  fireworks: {
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    extraHeaders: () => ({})
  },
  deepinfra: {
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    extraHeaders: () => ({})
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    extraHeaders: () => ({})
  },
  hyperbolic: {
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    extraHeaders: () => ({})
  },
  sambanova: {
    baseUrl: 'https://api.sambanova.ai/v1',
    extraHeaders: () => ({})
  },
  novita: {
    baseUrl: 'https://api.novita.ai/v3/openai',
    extraHeaders: () => ({})
  }
};

function loadAdv(app) {
  try {
    const type = (app?.selectedModel?.type || 'openrouter').toLowerCase();
    return JSON.parse(ConfigManager.get(`${type}ModelOptions`) || '{}') || {};
  } catch (_) {
    return {};
  }
}

export class OpenAICompatible {
  static resolveProvider(app) {
    const type = (app?.selectedModel?.type || '').toLowerCase();
    return OPENAI_COMPAT_PROVIDERS[type] || OPENAI_COMPAT_PROVIDERS.openrouter;
  }

  /**
   * Convert internal AgentLoop messages (Gemini-style functionCall / functionResponse parts)
   * into OpenAI Chat Completions format required by OpenRouter / Groq / etc.
   */
  static formatMessages(messages) {
    const formatted = [];
    let expectedToolCalls = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // 1) Model tool-call turn → assistant + tool_calls
      if (
        (msg.role === 'model' || msg.role === 'assistant') &&
        Array.isArray(msg.content) &&
        msg.content.some(p => p.functionCall)
      ) {
        const textPart = msg.content.find(p => p.text);
        const tool_calls = msg.content.filter(p => p.functionCall).map(part => {
          const fc = part.functionCall;
          const args =
            typeof fc.args === 'string' ? fc.args : JSON.stringify(fc.args || {});
          return {
            id: fc.id || `call_${Math.random().toString(36).slice(2)}`,
            type: 'function',
            function: {
              name: fc.name,
              arguments: args
            }
          };
        });

        const assistantMsg = { role: 'assistant', tool_calls };
        assistantMsg.content = (textPart && textPart.text) ? textPart.text : '';
        formatted.push(assistantMsg);
        expectedToolCalls = tool_calls.map(tc => tc.id);
        continue;
      }

      // 2) Tool results → role: tool (match by id, else by order for orphan ids)
      if (
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.some(p => p.functionResponse)
      ) {
        msg.content.filter(p => p.functionResponse).forEach(part => {
          const fr = part.functionResponse;
          let callId = fr.id;
          if (callId && expectedToolCalls.includes(callId)) {
            expectedToolCalls = expectedToolCalls.filter(id => id !== callId);
          } else if (expectedToolCalls.length) {
            // Model/provider id mismatch — consume next pending tool_call id
            callId = expectedToolCalls.shift();
          } else {
            callId = callId || `call_orphan_${Math.random().toString(36).slice(2, 8)}`;
          }
          formatted.push({
            role: 'tool',
            name: fr.name,
            tool_call_id: callId,
            content:
              typeof fr.response === 'string'
                ? fr.response
                : JSON.stringify(fr.response ?? {})
          });
        });
        continue;
      }

      // 3) Hanging tool_calls without responses → inject stubs (avoids 400)
      // Only when next message is NOT more tool results (already handled above)
      if (expectedToolCalls.length > 0) {
        // Quiet for common agent nudges that insert user text mid-loop
        if (expectedToolCalls.length > 2) {
          console.warn('[OpenAICompat] Missing tool responses — injecting', expectedToolCalls.length, 'abort stubs');
        }
        expectedToolCalls.forEach(id => {
          formatted.push({
            role: 'tool',
            name: 'abort',
            tool_call_id: id,
            content: JSON.stringify({ error: 'Tool response missing / interrupted.' })
          });
        });
        expectedToolCalls = [];
      }

      // 4) Regular text / multimodal user messages
      const role =
        msg.role === 'model' || msg.role === 'assistant'
          ? 'assistant'
          : msg.role === 'system'
            ? 'system'
            : 'user';

      if (Array.isArray(msg.content) && msg.content.some(c => c?.type === 'image_url' || c?.type === 'file')) {
        // OpenAI multimodal: keep image_url parts; fold file text into the text part
        const parts = [];
        const fileNotes = [];
        for (const c of msg.content) {
          if (!c) continue;
          if (c.type === 'text' && c.text) parts.push({ type: 'text', text: c.text });
          else if (c.type === 'image_url' && c.image_url?.url) {
            parts.push({ type: 'image_url', image_url: { url: c.image_url.url } });
          } else if (c.type === 'file') {
            fileNotes.push(`[Attached File: ${c.name || 'file'}]\n${c.text || c.data || ''}`);
          }
        }
        if (fileNotes.length) {
          const note = fileNotes.join('\n\n');
          const ti = parts.findIndex(p => p.type === 'text');
          if (ti >= 0) parts[ti].text = (parts[ti].text || '') + '\n\n' + note;
          else parts.unshift({ type: 'text', text: note });
        }
        if (!parts.length) parts.push({ type: 'text', text: '(silent action completed)' });
        formatted.push({ role, content: parts });
      } else {
        let content = msg.content;
        if (Array.isArray(msg.content)) {
          content = msg.content.map(c => c.text || '').join('\n');
        }
        if (content == null || String(content).trim() === '') {
          content = '(silent action completed)';
        }
        formatted.push({ role, content: String(content) });
      }
    }

    return formatted;
  }

  static async generateStream(options, app, onChunk) {
    const {
      apiKey,
      model,
      messages,
      signal,
      tools,
      forceToolUse,
      allowedFunctionNames,
      maxOutputTokensOverride,
      onToolPartial // optional: ({ id, name, argsString }) => void — live tool-arg stream
    } = options;

    const provider = this.resolveProvider(app);
    const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;
    const type = (app?.selectedModel?.type || 'openrouter').toLowerCase();
    const adv = loadAdv(app);
    const hasTools = !!(tools && tools.length);

    // Convert agent-loop internal format → OpenAI messages
    let formattedMessages = this.formatMessages(Array.isArray(messages) ? messages : []);

    // System instruction (agent vs normal). Always ensure simulated-think markers
    // are present when flag is set — even if history already has a system message.
    const sysText = (() => {
      try {
        return getSystemInstruction(app) || SYSTEM_INSTRUCTION;
      } catch (_) {
        return SYSTEM_INSTRUCTION;
      }
    })();
    const hasSystem = formattedMessages.some(m => m.role === 'system');
    if (!hasSystem && sysText) {
      formattedMessages = [{ role: 'system', content: sysText }, ...formattedMessages];
    } else if (hasSystem && app?._injectSimulatedThinkPrompt) {
      try {
        const { SIMULATED_THINK_INSTRUCTION } = await import('../SystemPrompt.js');
        formattedMessages = formattedMessages.map((m, idx) => {
          if (m.role !== 'system' || idx !== 0) return m;
          const c = String(m.content || '');
          if (/BEGIN_REASON/.test(c)) return m;
          return { ...m, content: `${SIMULATED_THINK_INSTRUCTION}

${c}` };
        });
      } catch (_) {}
    }

    // Advanced tab settings (openrouterModelOptions.max_tokens etc.)
    // Do NOT hard-floor to 8192 — OpenRouter rejects when key cannot afford max_tokens.
    let maxTokens = 4000;
    if (maxOutputTokensOverride != null && Number(maxOutputTokensOverride) > 0) {
      maxTokens = Number(maxOutputTokensOverride);
    } else if (adv.max_tokens != null && Number(adv.max_tokens) > 0) {
      maxTokens = Number(adv.max_tokens);
    }

    // Soft floors only: tools need some headroom for JSON, but respect low credits


    if (hasTools) {
      const TOOL_SOFT_FLOOR = 2048;
      if (!maxTokens || maxTokens < TOOL_SOFT_FLOOR) {
        maxTokens = Math.max(maxTokens || 0, TOOL_SOFT_FLOOR);
      }
    } else if (!maxTokens || maxTokens < 1024) {
      maxTokens = Math.max(maxTokens || 0, 1024);
    }

    const temperature = hasTools
      ? 0.1
      : (adv.temperature != null ? Number(adv.temperature) : 0.7);

    const reqBody = {
      model,
      messages: formattedMessages,
      max_tokens: maxTokens,
      temperature,
      stream: true
    };

    if (adv.top_p != null) reqBody.top_p = Number(adv.top_p);
    if (adv.presence_penalty != null) reqBody.presence_penalty = Number(adv.presence_penalty);
    if (adv.frequency_penalty != null) reqBody.frequency_penalty = Number(adv.frequency_penalty);

    // reasoning_effort ONLY for models with a real thinking channel.
    // Sending it to Qwen/flash-style models makes them invent "Analyze User Input /
    // Determine Response…" essays in content — not real think tags — and confuses the UI.
    try {
      const nativeThink = modelSupportsNativeThink(app);
      let level = null;
      if (nativeThink && app?.chatInputUI?.states?.think) {
        level = String(app.chatInputUI.states.thinkLevel || 'medium').toLowerCase();
      } else if (nativeThink) {
        try {
          const { ConfigManager } = await import('../../utils/ConfigManager.js');
          const always = ConfigManager.get('agentThinkingAlways');
          if (always === true || always === 'true') {
            level = String(ConfigManager.get('agentThinkingEffort') || 'medium').toLowerCase();
          }
        } catch (_) {}
      }
      if (level && ['low', 'medium', 'high'].includes(level)) {
        reqBody.reasoning_effort = level;
      }
    } catch (_) {
      // never force reasoning_effort on unknown models
    }

    if (hasTools) {
      // Ensure JSON-schema types are lowercase (OpenAI strictness)
      const cleanTools = JSON.parse(JSON.stringify(tools)).map(tool => {
        const walk = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          if (typeof obj.type === 'string') obj.type = obj.type.toLowerCase();
          for (const k of Object.keys(obj)) walk(obj[k]);
        };
        walk(tool);
        return tool;
      });

      let finalTools = cleanTools;
      if (Array.isArray(allowedFunctionNames) && allowedFunctionNames.length) {
        finalTools = cleanTools.filter(t =>
          allowedFunctionNames.includes(t.function?.name)
        );
        if (!finalTools.length) finalTools = cleanTools;
      }
      reqBody.tools = finalTools;

      if (forceToolUse && Array.isArray(allowedFunctionNames) && allowedFunctionNames.length === 1) {
        reqBody.tool_choice = {
          type: 'function',
          function: { name: allowedFunctionNames[0] }
        };
      } else {
        reqBody.tool_choice = forceToolUse ? 'required' : 'auto';
      }
    }


    // ThinkDebug — after reqBody is fully built (safe to read)
    try {
      let nativeThink = false;
      let forceNonNative = false;
      try { nativeThink = modelSupportsNativeThink(app); } catch (_) {}
      try {
        const { isForceNonNativeThinkingEnabled } = await import('../thinking/ThinkCapability.js');
        forceNonNative = isForceNonNativeThinkingEnabled(app);
      } catch (_) {}
      const sysMsg = formattedMessages.find(m => m.role === 'system');
      const userMsgs = formattedMessages.filter(m => m.role === 'user');
      const lastUser = userMsgs[userMsgs.length - 1];
      const userContent = lastUser
        ? (typeof lastUser.content === 'string' ? lastUser.content : JSON.stringify(lastUser.content))
        : '';
      app._lastThinkDebug = {
        at: Date.now(),
        model,
        thinkToggle: !!(app?.chatInputUI?.states?.think),
        nativeThink,
        forceNonNative,
        reasoning_effort: reqBody.reasoning_effort || null,
        systemHead: String(sysMsg?.content || '').slice(0, 400),
        systemTail: String(sysMsg?.content || '').slice(-400),
        injectSimulatedThink: !!app?._injectSimulatedThinkPrompt,
        hasBeginReasonInSystem: /BEGIN_REASON/.test(String(sysMsg?.content || '')),
        userHead: String(userContent || '').slice(0, 200),
        max_tokens: reqBody.max_tokens,
        hasTools: !!(reqBody.tools && reqBody.tools.length)
      };
      console.log('[ThinkDebug] request', JSON.stringify(app._lastThinkDebug, null, 2));
    } catch (e) {
      console.warn('[ThinkDebug] request log failed', e);
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(provider.extraHeaders ? provider.extraHeaders() : {})
    };

    console.log(
      '[OpenAICompatible]',
      type,
      '→',
      url,
      'model=',
      model,
      'max_tokens=',
      maxTokens,
      'tools=',
      hasTools ? (reqBody.tools?.length || 0) : 0,
      'adv.max_tokens=',
      adv.max_tokens
    );

    // One automatic retry if OpenRouter says max_tokens exceeds credit budget
    let response = await providerFetch(app, () => fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
      signal
    }), { signal });

    if (!response.ok) {
      let errMsg = `API Error (${response.status})`;
      let errBody = null;
      try {
        errBody = await response.json();
        errMsg = errBody.error?.message || errBody.message || errMsg;
        if (errBody.error?.metadata?.raw) {
          errMsg += ` | ${String(errBody.error.metadata.raw).slice(0, 200)}`;
        }
      } catch (_) {
        try { errMsg = (await response.text()).slice(0, 400) || errMsg; } catch (__) {}
      }

      // "You requested up to 8192 tokens, but can only afford 1169"
      const affordMatch = String(errMsg).match(/can only afford\s+(\d+)/i);
      if (affordMatch && !reqBody._affordRetried) {
        // Tools need more headroom than 256 — free-tier 165–256 often truncates mid-tool JSON
        const rawAfford = parseInt(affordMatch[1], 10) || 0;
        const minFloor = hasTools ? 512 : 256;
        const affordable = Math.max(minFloor, rawAfford);
        if (rawAfford > 0 && rawAfford < 1024) {
          console.warn(
            '[OpenAICompatible] LOW CREDIT BUDGET afford=', rawAfford,
            'hasTools=', hasTools, '— agent may stop mid-task. Top up OpenRouter credits or lower context.'
          );
        }
        if (rawAfford > 0 && affordable < maxTokens) {
          console.warn(
            '[OpenAICompatible] max_tokens', maxTokens,
            'exceeds credit budget', rawAfford, '— retrying with', Math.min(affordable, rawAfford || affordable)
          );
          // Never request more than OpenRouter said we can afford
          reqBody.max_tokens = Math.min(affordable, rawAfford || affordable);
          reqBody._affordRetried = true;
          maxTokens = affordable;
          response = await providerFetch(app, () => fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...reqBody, _affordRetried: undefined }),
            signal
          }), { signal });
          if (response.ok) {
            // fall through to stream handling below
          } else {
            try {
              const e2 = await response.json();
              errMsg = e2.error?.message || e2.message || errMsg;
            } catch (_) {}
            if (/tool/i.test(errMsg) && /support|not available|does not/i.test(errMsg)) {
              errMsg += ' — Pick a model that supports tool calling.';
            }
            throw new Error(errMsg);
          }
        } else {
          if (/tool/i.test(errMsg) && /support|not available|does not/i.test(errMsg)) {
            errMsg += ' — Pick a model that supports tool calling.';
          }
          throw new Error(errMsg);
        }
      } else {
        if (/tool/i.test(errMsg) && /support|not available|does not/i.test(errMsg)) {
          errMsg += ' — Pick a model that supports tool calling.';
        }
        throw new Error(errMsg);
      }
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (content) onChunk(content);
      const toolCalls = data.choices?.[0]?.message?.tool_calls || [];
      const parsedFunctionCalls = toolCalls.map(tc => {
        const name = tc.function?.name;
        let args = {};
        const rawArgs = typeof tc.function?.arguments === 'string'
          ? tc.function.arguments
          : (tc.function?.arguments != null ? JSON.stringify(tc.function.arguments) : '{}');
        try {
          args = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : (tc.function?.arguments || {});
        } catch (_) {
          const repaired = repairToolArgs(name, rawArgs);
          if (repaired.ok) {
            args = repaired.args;
            console.warn('[OpenAICompat] repaired tool JSON for', name,
              repaired.salvaged ? '(salvaged complete files)' : '(brace fix)');
          } else {
            args = repaired.args || { _parseError: true, _raw: String(rawArgs || '') };
          }
        }
        return { id: tc.id, name, args };
      });
      const parts = [];
      if (content) parts.push({ text: content });
      parsedFunctionCalls.forEach(fc => parts.push({ functionCall: fc }));
      return { finishReason: streamFinishReason || null, functionCalls: parsedFunctionCalls, rawParts: parts };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const currentToolCalls = {};
    let textBuffer = '';
    let hasStartedThinking = false;
    let hasFinishedThinking = false;
    let streamFinishReason = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:') || trimmed.includes('[DONE]')) continue;
          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            const choice0 = json.choices?.[0];
            if (choice0?.finish_reason) streamFinishReason = choice0.finish_reason;
            const delta = choice0?.delta;
            if (!delta) continue;
            // CRITICAL: Only wrap API reasoning_content for NATIVE think models.
            // Qwen/OpenRouter often emits a few chars of "reasoning" then the same
            // sentence continues in content → "I need to pr" | "ovide…" mid-word split.
            // Non-native: never inject <think>; let content markers (BEGIN_REASON) parse in ChatHandler.
            const thinkOn = !!(app?.chatInputUI?.states?.think);
            let nativeThink = false;
            try { nativeThink = modelSupportsNativeThink(app); } catch (_) {}
            const reasoning =
              delta.reasoning_content ||
              delta.reasoning ||
              (typeof delta.reasoning === 'object' ? delta.reasoning?.content : null);

            if (nativeThink && thinkOn && reasoning) {
              if (!hasStartedThinking) {
                onChunk('<think>');
                hasStartedThinking = true;
              }
              onChunk(String(reasoning));
              try {
                if (app && !app._thinkStreamDbg) app._thinkStreamDbg = { reasoningChars: 0, contentChars: 0 };
                if (app?._thinkStreamDbg) app._thinkStreamDbg.reasoningChars += String(reasoning).length;
              } catch (_) {}
            }
            if (delta.content != null && delta.content !== '') {
              textBuffer += delta.content;
              if (nativeThink && thinkOn && hasStartedThinking && !hasFinishedThinking) {
                onChunk('</think>');
                hasFinishedThinking = true;
              }
              onChunk(String(delta.content));
              try {
                if (app && !app._thinkStreamDbg) app._thinkStreamDbg = { reasoningChars: 0, contentChars: 0 };
                if (app?._thinkStreamDbg) app._thinkStreamDbg.contentChars += String(delta.content).length;
              } catch (_) {}
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                if (!currentToolCalls[index]) {
                  currentToolCalls[index] = {
                    id: tc.id,
                    name: tc.function?.name || '',
                    argsString: tc.function?.arguments || ''
                  };
                } else {
                  if (tc.function?.name) currentToolCalls[index].name = tc.function.name;
                  if (tc.id) currentToolCalls[index].id = tc.id;
                  if (tc.function?.arguments) {
                    currentToolCalls[index].argsString += tc.function.arguments;
                  }
                }
                // Natural live stream of tool arguments (no fake typing)
                if (typeof onToolPartial === 'function' && currentToolCalls[index]) {
                  try {
                    onToolPartial({
                      id: currentToolCalls[index].id || `partial-${index}`,
                      name: currentToolCalls[index].name,
                      argsString: currentToolCalls[index].argsString
                    });
                  } catch (_) {}
                }
              }
            }
          } catch (_) {}
        }
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }

    if (hasStartedThinking && !hasFinishedThinking) {
      try { onChunk('</think>'); } catch (_) {}
      hasFinishedThinking = true;
    }

    const parsedFunctionCalls = Object.values(currentToolCalls).map(tc => {
      let args = {};
      try {
        args = JSON.parse(tc.argsString || '{}');
      } catch (_) {
        const repaired = repairToolArgs(tc.name, tc.argsString || '');
        if (repaired.ok) {
          args = repaired.args;
          console.warn('[OpenAICompat] stream repaired tool JSON for', tc.name,
            repaired.salvaged ? '(salvaged complete files)' : '(brace fix)');
        } else {
          args = repaired.args || { _parseError: true, _raw: String(tc.argsString || '') };
        }
      }
      return { id: tc.id, name: tc.name, args };
    });
    const parts = [];
    if (textBuffer) parts.push({ text: textBuffer });
    parsedFunctionCalls.forEach(fc => parts.push({ functionCall: fc }));
    return { finishReason: streamFinishReason || null, functionCalls: parsedFunctionCalls, rawParts: parts };
  }

  /** List models via GET {baseUrl}/models */
  static async fetchModels(apiKey, meta = {}) {
    const type = (meta.modelType || meta.app?.selectedModel?.type || '').toLowerCase();
    const provider = OPENAI_COMPAT_PROVIDERS[type] || this.resolveProvider(meta.app);
    const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '');
    const url = `${baseUrl}/models`;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(provider.extraHeaders ? provider.extraHeaders() : {})
    };
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Fetch models failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const list = data.data || data.models || (Array.isArray(data) ? data : []);
    return list
      .map(m => {
        const id = m.id || m.name || String(m);
        const ctx = m.context_length
          || m.contextLength
          || m.top_provider?.context_length
          || null;
        const maxOut = m.top_provider?.max_completion_tokens
          || m.max_completion_tokens
          || m.max_output_tokens
          || null;
        const params = m.supported_parameters || m.supportedParameters || [];
        const supportsTools = Array.isArray(params)
          && params.some(p => String(p).toLowerCase() === 'tools' || String(p).toLowerCase() === 'tool_choice');
        const owned = m.owned_by || '';
        const desc = m.description || owned || '';
        return {
          id,
          name: m.name || id,
          description: desc,
          contextLength: ctx != null ? Number(ctx) : null,
          maxOutput: maxOut != null ? Number(maxOut) : null,
          supportsTools: !!supportsTools,
          pricing: m.pricing || null
        };
      })
      .filter(m => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  static getDocsHTML() {
    return `
      <div style="padding:12px;font-size:12px;line-height:1.55;color:var(--primary-text-color);">
        <b style="color:#4b5dd1;">OpenAI-compatible provider</b>
        <p style="margin:8px 0;">Uses the standard <code>/v1/chat/completions</code> API. Set your API key and a model id from the provider dashboard.</p>
        <ul style="padding-left:16px;margin:6px 0;color:var(--secondary-text-color);">
          <li>Tools / Agent mode supported when the model allows function calling</li>
          <li>Advanced tab Max Tokens is applied (agent soft-floor 2048; auto-retries lower if OpenRouter credit budget is tight)</li>
          <li>Think level maps to <code>reasoning_effort</code> when the model supports it</li>
          <li><b>Fetch Models</b> calls <code>GET /models</code> when enabled in config</li>
        </ul>
      </div>`;
  }
}
