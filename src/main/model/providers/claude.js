// src/main/core/model/chat/Claude.js
import { SYSTEM_INSTRUCTION } from "../SystemPrompt.js";
import { SubTabUI } from '../../ui/SubTabUI.js';
import { ConfigManager } from '../../utils/ConfigManager.js';
import { providerFetch } from '../../utils/network/RateLimitRetry.js';

function loadAdv() {
    try {
        return JSON.parse(ConfigManager.get('claudeModelOptions') || '{}') || {};
    } catch (_) {
        return {};
    }
}

export class Claude {

    // AgentRunner's `workingMessages` are built in a generic/Gemini-flavored shape
    // (role 'model', plain {text} parts, {functionCall}/{functionResponse} wrappers) — this
    // translates that into Anthropic's native message format (role 'assistant', content
    // blocks of type 'text' / 'tool_use' / 'tool_result'). System-role messages are handled
    // separately by the caller (Anthropic takes `system` as a top-level field, not a message).
    static formatMessages(messages) {
        return messages
            .filter(msg => msg.role !== 'system')
            .map(msg => {
                const role = (msg.role === 'model' || msg.role === 'assistant') ? 'assistant' : 'user';

                if (typeof msg.content === 'string') return { role, content: msg.content };
                if (!Array.isArray(msg.content)) return { role, content: String(msg.content ?? '') };

                const content = msg.content.map(part => {
                    // Already Anthropic-native (this is our own rawParts coming back around
                    // on a later step — see generateStream's return value below).
                    if (part && (part.type === 'text' || part.type === 'tool_use' || part.type === 'tool_result')) return part;

                    // Extended thinking — must round-trip unchanged (signature / redacted data)
                    if (part && part.type === 'thinking') {
                        const b = { type: 'thinking', thinking: String(part.thinking != null ? part.thinking : '') };
                        if (part.signature != null && part.signature !== '') b.signature = String(part.signature);
                        return b;
                    }
                    if (part && part.type === 'redacted_thinking') {
                        return { type: 'redacted_thinking', data: String(part.data || '') };
                    }

                    // Generic {text: "..."} part (skip pure thinking-only UI noise without type)
                    if (part && part.text !== undefined && !part.functionCall && !part.functionResponse) {
                        return { type: 'text', text: part.text };
                    }

                    // Gemini-flavored {functionCall:{name,args,id}} — a tool call the model made.
                    if (part && part.functionCall) {
                        return { type: 'tool_use', id: part.functionCall.id, name: part.functionCall.name, input: part.functionCall.args || {} };
                    }

                    // Gemini-flavored {functionResponse:{name,id,response}} — a tool's result being sent back.
                    if (part && part.functionResponse) {
                        const resp = part.functionResponse.response;
                        return { type: 'tool_result', tool_use_id: part.functionResponse.id, content: typeof resp === 'string' ? resp : JSON.stringify(resp ?? {}) };
                    }

                    return { type: 'text', text: typeof part === 'string' ? part : JSON.stringify(part) };
                });

                return { role, content };
            });
    }

    static async generateStream(options, app, onChunk) {
        const { apiKey, model, messages, signal, tools, forceToolUse } = options;

        let systemPrompt = "";
        let nonSystemMessages = [];

        // 🟢 Inject Universal System Instruction for Agent Mode
        if (tools && tools.length > 0) {
            systemPrompt += SYSTEM_INSTRUCTION + "\n\n";
        }

        for (let msg of messages) {
            if (msg.role === 'system') systemPrompt += (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)) + "\n";
            else nonSystemMessages.push(msg);
        }

        const cleanMessages = Claude.formatMessages(nonSystemMessages);
        const hasTools = tools && tools.length > 0;
        const adv = loadAdv();

        const body = {
            model: model || 'claude-3-5-sonnet-latest',
            system: systemPrompt.trim() || undefined,
            messages: cleanMessages,
            // Agent: more headroom for tool JSON; else advanced max_tokens
            max_tokens: hasTools
                ? Math.max(8192, Number(adv.max_tokens) || 4096)
                : (adv.max_tokens != null ? Number(adv.max_tokens) : 4096),
            temperature: hasTools ? 0.1 : (adv.temperature != null ? Number(adv.temperature) : 0.7),
            stream: true
        };
        if (!hasTools && adv.top_p != null) body.top_p = Number(adv.top_p);
        if (!hasTools && adv.top_k != null && Number(adv.top_k) > 0) body.top_k = Number(adv.top_k);
        if (adv.stop_sequences_preset === 'dbl_nl') body.stop_sequences = ['\n\n'];

        if (hasTools) {
            body.tools = tools; // already Anthropic-native {name, description, input_schema} — see ToolRegistry.getClaudeTools()
            // 🟢 Force a tool call in true Agent Mode (never in Study-Mode-only turns, which
            // mostly want a normal formatted text answer with an occasional tool call).
            if (forceToolUse) body.tool_choice = { type: "any" };
        }

        // Think toggle / settings → extended thinking budget (LOW/MEDIUM/HIGH)
        // Only UI Think toggle (never force always-on — models may still emit internal reasoning server-side)
        let thinkingEnabled = false;
        try {
            if (options?.disableThinking) thinkingEnabled = false;
            else thinkingEnabled = !!(app?.chatInputUI?.states?.think);
        } catch (_) {
            thinkingEnabled = !!(app?.chatInputUI?.states?.think);
        }

        if (thinkingEnabled) {
            let lvl = String(app?.chatInputUI?.states?.thinkLevel || '').toUpperCase();
            if (!lvl || lvl === 'MEDIUM') {
                try {
                    const s = String(ConfigManager.get('agentThinkingEffort') || 'medium').toLowerCase();
                    lvl = s === 'high' ? 'HIGH' : s === 'low' ? 'LOW' : 'MEDIUM';
                } catch (_) {
                    lvl = 'MEDIUM';
                }
            }
            const budget = lvl === 'HIGH' ? 16000 : lvl === 'LOW' ? 2048 : 8000;
            body.thinking = {
                type: 'enabled',
                budget_tokens: budget
                // display: 'summarized' — default on many Claude 4 models
            };
            // Anthropic: temperature must be 1 when thinking is enabled
            body.temperature = 1;
            // max_tokens must be strictly greater than budget_tokens
            const need = budget + 4096;
            if (!body.max_tokens || body.max_tokens <= budget) {
                body.max_tokens = Math.max(need, 8192);
            }
            // Forced tool_choice "any" + thinking can be fragile; prefer auto when thinking
            if (body.tool_choice && body.tool_choice.type === 'any') {
                delete body.tool_choice;
            }
            console.log('[Claude] extended thinking on budget=', budget, 'max_tokens=', body.max_tokens);
        }

        const response = await providerFetch(app, () => fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true', 
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: signal
        }), { signal });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `Claude API Error (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';

        // 🟢 Token Usage: Anthropic reports real input tokens on message_start,
        // and the final output token count on message_delta.
        const usage = { input_tokens: 0, output_tokens: 0 };

        // 🟢 Tool-use parsing: Anthropic streams each content block (text OR tool_use)
        // independently by index — text arrives as text_delta chunks, tool_use arguments
        // arrive as input_json_delta chunks that must be concatenated then JSON.parse'd
        // once the block closes.
        const blocks = []; // sparse array, index = Anthropic's content block index

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split("\n");
            buffer = lines.pop(); 
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                if (!trimmed) continue;

                if (trimmed.startsWith("data:")) {
                    try {
                        const jsonStr = trimmed.slice(5).trim();
                        if (jsonStr === "[DONE]") continue;
                        
                        const json = JSON.parse(jsonStr);

                        if (json.type === 'message_start' && json.message?.usage) {
                            usage.input_tokens = json.message.usage.input_tokens || 0;
                            usage.output_tokens = json.message.usage.output_tokens || 0;
                        }

                        if (json.type === 'content_block_start' && json.content_block) {
                            const idx = json.index;
                            const cb = json.content_block;
                            if (cb.type === 'tool_use') {
                                blocks[idx] = { type: 'tool_use', id: cb.id, name: cb.name, input: {}, _jsonBuf: '' };
                            } else if (cb.type === 'thinking') {
                                blocks[idx] = {
                                    type: 'thinking',
                                    thinking: cb.thinking || '',
                                    signature: cb.signature || ''
                                };
                                if (thinkingEnabled) {
                                    try { onChunk('<think>'); } catch (_) {}
                                    if (cb.thinking) {
                                        try { onChunk(String(cb.thinking)); } catch (_) {}
                                    }
                                }
                            } else if (cb.type === 'redacted_thinking') {
                                blocks[idx] = { type: 'redacted_thinking', data: cb.data || '' };
                                if (thinkingEnabled) {
                                    try { onChunk('<think>'); } catch (_) {}
                                    try {
                                        onChunk('[Some internal reasoning was encrypted for safety]\n');
                                    } catch (_) {}
                                }
                            } else {
                                blocks[idx] = { type: 'text', text: cb.text || '' };
                            }
                        }

                        if (json.type === 'content_block_delta' && json.delta) {
                            const idx = json.index;
                            const d = json.delta;
                            if (d.type === 'thinking_delta' && d.thinking) {
                                if (!blocks[idx]) blocks[idx] = { type: 'thinking', thinking: '', signature: '' };
                                blocks[idx].thinking = (blocks[idx].thinking || '') + d.thinking;
                                if (thinkingEnabled) {
                                    try { onChunk(String(d.thinking)); } catch (_) {}
                                }
                            } else if (d.type === 'signature_delta' && d.signature) {
                                if (!blocks[idx]) blocks[idx] = { type: 'thinking', thinking: '', signature: '' };
                                blocks[idx].signature = (blocks[idx].signature || '') + d.signature;
                            } else if (d.type === 'text_delta' && d.text) {
                                // Close thinking channel before answer text
                                if (thinkingEnabled && blocks.some(b => b && b.type === 'thinking' && !b._closedForUi)) {
                                    for (const b of blocks) {
                                        if (b && b.type === 'thinking' && !b._closedForUi) {
                                            b._closedForUi = true;
                                        }
                                    }
                                    try { onChunk('</think>'); } catch (_) {}
                                }
                                if (!blocks[idx]) blocks[idx] = { type: 'text', text: '' };
                                blocks[idx].text += d.text;
                                onChunk(d.text);
                            } else if (d.type === 'input_json_delta' && d.partial_json) {
                                if (blocks[idx]) blocks[idx]._jsonBuf = (blocks[idx]._jsonBuf || '') + d.partial_json;
                            }
                        }

                        if (json.type === 'content_block_stop') {
                            const b = blocks[json.index];
                            if (b && b.type === 'tool_use') {
                                try { b.input = b._jsonBuf ? JSON.parse(b._jsonBuf) : {}; }
                                catch (e) { console.warn('[Claude] Could not parse tool_use input JSON, defaulting to {}:', b._jsonBuf, e); b.input = {}; }
                                delete b._jsonBuf;
                            }
                            if (thinkingEnabled && b && (b.type === 'thinking' || b.type === 'redacted_thinking') && !b._closedForUi) {
                                b._closedForUi = true;
                                try { onChunk('</think>'); } catch (_) {}
                            }
                            // Strip internal UI flags before round-trip
                            if (b) {
                                delete b._closedForUi;
                                delete b._jsonBuf;
                            }
                        }

                        if (json.type === 'message_delta' && json.usage) {
                            usage.output_tokens = json.usage.output_tokens ?? usage.output_tokens;
                        }
                    } catch (e) {}
                }
            }
        }

        const rawParts = blocks.filter(Boolean).map(b => {
            if (!b) return b;
            const copy = { ...b };
            delete copy._closedForUi;
            delete copy._jsonBuf;
            return copy;
        });
        const functionCalls = rawParts
            .filter(b => b.type === 'tool_use')
            .map(b => ({ id: b.id, name: b.name, args: b.input }));

        if (app?.usageManager && (usage.input_tokens || usage.output_tokens)) {
            app.usageManager.recordUsage('claude', usage.input_tokens, usage.output_tokens, { estimated: false });
            app._lastRequestUsageRecorded = true;
        }

        return { functionCalls, rawParts, usage };
    }
    
    // ... [generateTitle, fetchModels, getDocsHTML remain exactly the same]
    static async generateTitle(prompt, apiKey, modelId) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 
                'x-api-key': apiKey, 
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                model: 'claude-3-haiku-20240307', 
                messages: [{role: 'user', content: prompt}], 
                max_tokens: 15,
                temperature: 0.3
            })
        });
        const data = await response.json();
        return data.content?.[0]?.text;
    }

    static async fetchModels(apiKey) {
        return [
            "claude-3-5-sonnet-latest",
            "claude-3-5-haiku-latest",
            "claude-3-opus-latest",
            "claude-3-sonnet-20240229",
            "claude-3-haiku-20240307"
        ];
    }

    static getDocsHTML() {
        const tabsData = [
            {
                title: 'Claude API Reference',
                activeColor: '#d97757',
                default: true,
                content: `
                    <div style="background: rgba(217, 119, 87, 0.1); border-left: 4px solid #d97757; padding: 12px; border-radius: 0 8px 8px 0; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97757" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
                            <path d="M12 12 2.1 7.1"></path>
                            <path d="M12 12l9.9 4.9"></path>
                        </svg>
                        <div>
                            <b style="color: #d97757; font-size: 15px;">Anthropic Messages API</b>
                            <p style="margin: 4px 0 0 0; font-size: 11px; color: var(--primary-text-color);">Latest Claude 3.5 Models • Base URL: <code>https://api.anthropic.com/v1</code></p>
                        </div>
                    </div>

                    <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <b style="color: #d97757;">Overview</b>
                        <p style="font-size: 11px; margin: 8px 0; white-space: pre-line;">The Messages API allows you to interact with Claude, Anthropic's state-of-the-art AI. Claude 3.5 Sonnet excels at coding, reasoning, and complex instructions.</p>
                        <small style="color:#888; display:block;">Official Docs: <a href="https://docs.anthropic.com/en/api/messages" target="_blank" style="color:#4caf50;">docs.anthropic.com/api</a></small>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <b style="color: var(--active-text-color); font-size: 13px;">cURL Request Example</b>
                        <pre style="background:#1e1e1e; padding:10px; margin:8px 0; font-size:10px; border-radius:6px; overflow-x:auto;"><code>curl https://api.anthropic.com/v1/messages \\
     --header "x-api-key: {{API_KEY}}" \\
     --header "anthropic-version: 2023-06-01" \\
     --header "content-type: application/json" \\
     --data '{
         "model": "claude-3-5-sonnet-latest",
         "max_tokens": 1024,
         "messages": [
             {"role": "user", "content": "Hello, Claude"}
         ]
     }'</code></pre>
                    </div>
                `
            },
            {
                title: 'Browser & CORS Info',
                activeColor: '#f44336',
                content: `
                    <div style="background: rgba(244, 67, 54, 0.1); border-left: 4px solid #f44336; padding: 12px; border-radius: 0 8px 8px 0; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        <div>
                            <b style="color: #f44336; font-size: 15px;">Client-Side Execution</b>
                            <p style="margin: 4px 0 0 0; font-size: 11px; color: var(--primary-text-color);">CORS & Browser Fetching</p>
                        </div>
                    </div>

                    <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <b style="color: #f44336;">Direct Browser Access</b>
                        <p style="font-size: 11px; margin: 8px 0; white-space: pre-line;">Anthropic generally blocks direct requests from browsers to protect API keys. However, this application securely injects the <code>anthropic-dangerous-direct-browser-access: true</code> header to allow seamless communication directly from your client without needing an external proxy.</p>
                        <p style="font-size: 11px; color:#888; margin-top:5px;"><i>Note: Keep your API keys safe and do not share your local environment variables.</i></p>
                    </div>
                `
            }
        ];

        return SubTabUI.generate(tabsData);
    }
}