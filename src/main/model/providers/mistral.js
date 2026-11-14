// src/main/core/model/chat/Mistral.js
import { getSystemInstruction, SYSTEM_INSTRUCTION } from "../SystemPrompt.js"
import { ConfigManager } from '../../utils/ConfigManager.js';
import { repairToolArgs } from '../../utils/agent/ToolArgsSalvage.js';
import { fetchWithRateLimitRetry } from '../../utils/network/RateLimitRetry.js';

function loadAdv() {
    try {
        return JSON.parse(ConfigManager.get('mistralModelOptions') || '{}') || {};
    } catch (_) {
        return {};
    }
}

export class Mistral {
    
    static formatMessages(messages) {
        const formatted = [];
        // Pending assistant tool_calls that must be answered before any other role
        let pending = []; // { id, name }

        const flushPending = (reason = 'unanswered') => {
            if (!pending.length) return;
            console.warn('[Mistral] injecting tool results for', pending.length, 'pending call(s):', reason);
            for (const p of pending) {
                formatted.push({
                    role: 'tool',
                    name: p.name || 'tool',
                    tool_call_id: p.id,
                    content: JSON.stringify({ error: reason })
                });
            }
            pending = [];
        };

        const stableId = (raw, name, idx) => {
            const s = String(raw || '').trim();
            if (s) return s;
            // Deterministic fallback so re-format matches tool results when id was missing
            return `call_${String(name || 'tool').slice(0, 24)}_${idx}`;
        };

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (!msg) continue;

            const hasFc = msg.role === 'model' && Array.isArray(msg.content)
                && msg.content.some(p => p && p.functionCall);
            const hasFr = Array.isArray(msg.content)
                && msg.content.some(p => p && p.functionResponse);

            // 1) Assistant tool calls
            if (hasFc) {
                flushPending('superseded');
                const textPart = msg.content.find(p => p && p.text && String(p.text).trim());
                const fcs = msg.content.filter(p => p && p.functionCall);
                const tool_calls = fcs.map((part, idx) => {
                    const fc = part.functionCall;
                    const args = typeof fc.args === 'string'
                        ? fc.args
                        : JSON.stringify(fc.args || {});
                    const id = stableId(fc.id, fc.name, idx);
                    // mutate so later functionResponse can reuse same id if missing
                    try { if (!fc.id) fc.id = id; } catch (_) {}
                    return {
                        id,
                        type: 'function',
                        function: { name: fc.name || 'tool', arguments: args || '{}' }
                    };
                }).filter(tc => tc.function.name);

                if (!tool_calls.length) {
                    // tool-call message with no usable calls → plain assistant text
                    let t = textPart?.text || '(empty)';
                    formatted.push({ role: 'assistant', content: t });
                    continue;
                }

                formatted.push({
                    role: 'assistant',
                    content: textPart?.text != null ? String(textPart.text) : '',
                    tool_calls
                });
                pending = tool_calls.map(tc => ({ id: tc.id, name: tc.function.name }));
                continue;
            }

            // 2) Tool results (may share a user message with text — only take functionResponse parts)
            if (hasFr) {
                const frs = msg.content.filter(p => p && p.functionResponse);
                for (let j = 0; j < frs.length; j++) {
                    const fr = frs[j].functionResponse;
                    let id = String(fr.id || '').trim();
                    if (!id && pending[j]) id = pending[j].id;
                    if (!id && pending.length === 1) id = pending[0].id;
                    // Drop synthetic / orphan tool results (e.g. id "auto-explore") — they cause HTTP 400
                    if (pending.length && id && !pending.some(p => p.id === id)) {
                        console.warn('[Mistral] skip orphan tool result id=', id);
                        continue;
                    }
                    if (!pending.length) {
                        // No open tool_calls from assistant — never emit role:tool (Mistral 400)
                        console.warn('[Mistral] skip tool result with no pending assistant tool_calls id=', id || fr.name);
                        continue;
                    }
                    if (!id) {
                        id = stableId(null, fr.name, j);
                    }
                    const name = fr.name || (pending.find(p => p.id === id)?.name) || 'tool';
                    let content = fr.response;
                    if (content == null) content = {};
                    if (typeof content !== 'string') {
                        try { content = JSON.stringify(content); } catch (_) { content = String(content); }
                    }
                    formatted.push({
                        role: 'tool',
                        name,
                        tool_call_id: id,
                        content: content || '{}'
                    });
                    pending = pending.filter(p => p.id !== id);
                }
                // leftover text on same message after tools → user msg only if no pending
                const textBits = msg.content.filter(p => p && p.text).map(p => p.text).join('\n').trim();
                if (textBits) {
                    flushPending('before_user_text');
                    formatted.push({ role: 'user', content: textBits });
                }
                continue;
            }

            // 3) Normal chat — must not leave pending tool_calls
            flushPending('before_next_message');

            let content = msg.content;
            if (Array.isArray(msg.content)) {
                content = msg.content.map(c => (c && c.text) || '').join('\n');
            }
            if (content == null) content = '';
            content = String(content);
            if (!content.trim()) content = '(silent)';

            const role = (msg.role === 'model' || msg.role === 'assistant') ? 'assistant' : 'user';
            // Mistral rejects consecutive same-role messages sometimes — merge if needed
            const last = formatted[formatted.length - 1];
            if (last && last.role === role && typeof last.content === 'string' && !last.tool_calls) {
                last.content = (last.content + '\n' + content).trim();
            } else {
                formatted.push({ role, content });
            }
        }

        flushPending('end_of_history');
        return formatted;
    }

    static async generateStream(options, app, onChunk) {
        const { apiKey, model, messages, signal, tools, forceToolUse, allowedFunctionNames } = options;
        
        const url = `https://api.mistral.ai/v1/chat/completions`;

        let formattedMessages = this.formatMessages(messages);

        const adv = loadAdv();
        const hasTools = !!(tools && tools.length);
        const reqBody = {
            model: model,
            messages: formattedMessages,
            stream: true,
            temperature: hasTools ? 0.1 : (adv.temperature != null ? Number(adv.temperature) : 0.7)
        };
        if (adv.top_p != null) reqBody.top_p = Number(adv.top_p);
        if (adv.max_tokens != null) reqBody.max_tokens = Number(adv.max_tokens);
        // Tool args (create_file_tree) get truncated at low max_tokens → JSON parse fail
        if (hasTools) {
            const cur = Number(reqBody.max_tokens || 0);
            if (!cur || cur < 8192) reqBody.max_tokens = 8192;
        } else {
            // Full multi-file codegen needs large completion budget
            const cur = Number(reqBody.max_tokens || 0);
            if (!cur || cur < 16384) reqBody.max_tokens = 16384;
        }
        if (adv.presence_penalty != null) reqBody.presence_penalty = Number(adv.presence_penalty);
        if (adv.frequency_penalty != null) reqBody.frequency_penalty = Number(adv.frequency_penalty);
        if (adv.random_seed != null && Number(adv.random_seed) > 0) reqBody.random_seed = Number(adv.random_seed);
        if (adv.safe_prompt === true) reqBody.safe_prompt = true;

        // Always inject coding-agent system prompt (was tools-only before → codegen
        // fallback with tools=null got no rules and refused to write code).
        reqBody.messages.unshift({
            role: 'system',
            content: getSystemInstruction(app)
        });

        if (hasTools) {
            const cleanTools = JSON.parse(JSON.stringify(tools)).map(tool => {
                const traverseAndFix = (obj) => {
                    if (!obj || typeof obj !== 'object') return;
                    if (obj.type && typeof obj.type === 'string') {
                        obj.type = obj.type.toLowerCase();
                    }
                    for (const key in obj) {
                        traverseAndFix(obj[key]);
                    }
                };
                traverseAndFix(tool);
                return tool;
            });
            reqBody.tools = cleanTools;
            if (forceToolUse && Array.isArray(allowedFunctionNames) && allowedFunctionNames.length === 1) {
                reqBody.tool_choice = { type: "function", function: { name: allowedFunctionNames[0] } };
            } else {
                reqBody.tool_choice = forceToolUse ? "required" : "auto";
            }
            if (Array.isArray(allowedFunctionNames) && allowedFunctionNames.length && Array.isArray(reqBody.tools)) {
                reqBody.tools = reqBody.tools.filter(t => allowedFunctionNames.includes(t.function?.name));
            }
            // Avoid parallel tool-call protocol quirks on some Mistral models
            reqBody.parallel_tool_calls = false;
        }

                const response = await fetchWithRateLimitRetry(
            () => fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify(reqBody),
                signal
            }),
            {
                signal,
                maxAttempts: 6,
                app,
                provider: app?.selectedModel?.type || 'mistral'
            }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const detail = errorData.error?.message || errorData.message || JSON.stringify(errorData).slice(0, 400);
            console.error('[Mistral] HTTP', response.status, detail);
            console.error('[Mistral] req tools=', hasTools, 'msgs=', formattedMessages.length,
              'lastRoles=', formattedMessages.slice(-4).map(m => m.role + (m.tool_calls ? '+tc' : '')));
            throw new Error(detail || `Mistral API Error (${response.status})`);
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || "";
            if (content) onChunk(content);
            
            // 🟢 ULTIMATE FIX: Preserve Text Content
            return { functionCalls: [], rawParts: [{ text: content }] }; 
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        
        let currentToolCalls = {}; 
        let textBuffer = "";
        
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split("\n");
                let lazyIntercepted = false;
                
                for(const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith("data:") && !trimmed.includes("[DONE]")) {
                        try {
                            const json = JSON.parse(trimmed.slice(5).trim());
                            const choice0 = json.choices?.[0];
                            const delta = choice0?.delta;
                            if (choice0?.finish_reason) {
                              console.log("[Mistral] finish_reason=", choice0.finish_reason);
                            }
                            if (!delta) continue;
                            
                            // Streaming Text
                            if (delta.content) {
                                textBuffer += delta.content;
                                onChunk(delta.content);
                                // Do NOT abort on ``` — that cut codegen mid-stream (textLen~320, 0 blocks).
                            }
                            
                            // Streaming Tool Calls Parsing
                            if (delta.tool_calls) {
                                for (const tc of delta.tool_calls) {
                                    const index = tc.index;
                                    if (!currentToolCalls[index]) {
                                        currentToolCalls[index] = {
                                            id: tc.id || `call_mistral_${index}`,
                                            name: tc.function?.name || "",
                                            argsString: tc.function?.arguments || ""
                                        };
                                    } else {
                                        if (tc.id && !currentToolCalls[index].id) {
                                            currentToolCalls[index].id = tc.id;
                                        }
                                        if (tc.function?.name) {
                                            currentToolCalls[index].name = tc.function.name;
                                        }
                                        if (tc.function?.arguments) {
                                            currentToolCalls[index].argsString += tc.function.arguments;
                                        }
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                }
                
                // 🛑 কানেকশন ক্যানসেল করা হচ্ছে, যাতে এআই আর টোকেন খরচ না করতে পারে।
                if (false && lazyIntercepted) { // disabled: was aborting code streams
                    reader.cancel().catch(() => {});
                    
                    const toolCallsArray = Object.values(currentToolCalls);
                    const parsedFunctionCalls = toolCallsArray.map(tc => {
                        let args = {};
                        try { args = JSON.parse(tc.argsString); } catch(e) {}
                        return { id: tc.id, name: tc.name, args: args };
                    });
                    
                    // 🟢 ULTIMATE FIX: Inject the Intercepted Text into rawParts!
                    let parts = [];
                    if (textBuffer) parts.push({ text: textBuffer });
                    parts = parts.concat(parsedFunctionCalls.map(fc => ({ functionCall: fc })));
                    
                    return {
                        functionCalls: parsedFunctionCalls,
                        rawParts: parts,
                        intercepted: true 
                    };
                }
            }
        } finally {
            reader.releaseLock();
        }

        // 🟢 Assemble Tool Calls and Pass to AgentRunner
        const toolCallsArray = Object.values(currentToolCalls);
        let parsedFunctionCalls = [];
        if (toolCallsArray.length > 0) {
            parsedFunctionCalls = toolCallsArray.map(tc => {
                let args = {};
                try {
                  args = JSON.parse(tc.argsString);
                } catch (e) {
                  const repaired = repairToolArgs(tc.name, tc.argsString);
                  if (repaired.ok) {
                    args = repaired.args;
                    console.warn('[Mistral] repaired tool JSON for', tc.name,
                      repaired.salvaged ? '(salvaged partial files)' : '(brace fix)');
                  } else {
                    console.error('[Mistral] JSON parse error', e, 'argsString=', (tc.argsString || '').slice(0, 200));
                    args = repaired.args || { _parseError: true, _raw: String(tc.argsString || '') };
                  }
                }
                return { id: tc.id, name: tc.name, args: args };
            });
        }
        console.log("[Mistral] stream done textLen=", textBuffer.length, "tools=", parsedFunctionCalls.map(t => t.name),
          "textPreview=", (textBuffer || "").slice(0, 400) || "(empty)");
        
        // Inject Text for Normal Responses too!
        let parts = [];
        if (textBuffer) parts.push({ text: textBuffer });
        if (parsedFunctionCalls.length > 0) {
            parts = parts.concat(parsedFunctionCalls.map(fc => ({ functionCall: fc })));
        }
        
        return {
            functionCalls: parsedFunctionCalls,
            rawParts: parts 
        };
    }
    
    static async fetchModels(apiKey) {
        // string — fetch() was throwing on every call, so "Fetch Models" for Mistral never worked.
        const response = await fetch('https://api.mistral.ai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const data = await response.json();
        return data.data ? data.data.map(m => { return {id: m.id, name: m.id}; }) : [];
    }
    
    static async generateTitle(prompt, apiKey, modelId) {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelId, messages: [{role: 'user', content: prompt}], max_tokens: 15 })
        });
        const data = await response.json();
        return data.choices?.[0]?.message?.content;
    }

    static getDocsHTML() {
        return `
        <div style="padding: 12px; color: var(--primary-text-color); font-size: 12px; line-height: 1.5; overflow-y: auto; max-height: 320px; scrollbar-width: thin;">
            <div style="background: rgba(75, 93, 209, 0.1); border-left: 3px solid var(--active-color, #4b5dd1); padding: 10px; border-radius: 0 6px 6px 0; margin-bottom: 15px;">
                <b style="color: var(--active-text-color, #4b5dd1); font-size: 13px;">⚙ How Custom API Works (Placeholders)</b>
                <p style="margin: 6px 0 4px 0; font-size: 11px; color: var(--primary-text-color);">Do <b>NOT</b> manually type your chat messages or API keys in the JSON payload. Use these placeholders. The app will automatically replace them in the background during a chat:</p>
                <ul style="margin: 0; padding-left: 15px; font-size: 10.5px; color: var(--secondary-text-color);">
                    <li><code style="color:#4caf50;">{{API_KEY}}</code> : Injects your saved Mistral API Key.</li>
                    <li><code style="color:#4caf50;">{{MODEL_ID}}</code> : Injects your selected Model ID.</li>
                    <li><code style="color:#f44; font-weight:bold;">"{{MESSAGES}}"</code> : <b>CRITICAL!</b> Leave this exactly as is. The app replaces this with your live chat history.</li>
                </ul>
            </div>
            <!-- Docs HTML content remains unchanged -->
        </div>
        `;
    }
}