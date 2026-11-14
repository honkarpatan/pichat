// src/main/core/model/chat/DeepSeek.js
import { SYSTEM_INSTRUCTION } from "../SystemPrompt.js";
import { SubTabUI } from '../../ui/SubTabUI.js';

export class DeepSeek {

    // 🔴 FIX: this didn't exist before — `messages` (AgentRunner's generic/Gemini-flavored
    // shape: role 'model', {functionCall}/{functionResponse} parts) was being sent to DeepSeek
    // completely unconverted. That's invalid for an OpenAI-compatible API (needs role
    // 'assistant' + a top-level tool_calls array, and role 'tool' + tool_call_id for results,
    // not a functionCall/functionResponse wrapped inside `content`). Any agent turn past the
    // very first tool call would have been silently malformed. Mirrors Mistral.formatMessages,
    // since both APIs use the same OpenAI-style tool-calling wire format.
    static formatMessages(messages) {
        const formatted = [];
        let expectedToolCalls = [];

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            // 1. Tool call requests the model made.
            if (msg.role === 'model' && Array.isArray(msg.content) && msg.content.some(p => p.functionCall)) {
                const textPart = msg.content.find(p => p.text);
                const tool_calls = msg.content.filter(p => p.functionCall).map(part => {
                    const args = typeof part.functionCall.args === 'string' ? part.functionCall.args : JSON.stringify(part.functionCall.args || {});
                    return {
                        id: part.functionCall.id || `call_${Math.random().toString(36).slice(2)}`,
                        type: "function",
                        function: { name: part.functionCall.name, arguments: args }
                    };
                });

                formatted.push({ role: 'assistant', content: (textPart && textPart.text) ? textPart.text : "", tool_calls });
                expectedToolCalls = tool_calls.map(tc => tc.id); // the VERY NEXT message must satisfy these

            // 2. Tool results being sent back.
            } else if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.some(p => p.functionResponse)) {
                msg.content.filter(p => p.functionResponse).forEach(part => {
                    formatted.push({
                        role: 'tool',
                        name: part.functionResponse.name,
                        tool_call_id: part.functionResponse.id,
                        content: typeof part.functionResponse.response === 'string' ? part.functionResponse.response : JSON.stringify(part.functionResponse.response)
                    });
                    expectedToolCalls = expectedToolCalls.filter(id => id !== part.functionResponse.id);
                });

            // 3. Regular chat messages (also covers role 'system', passed through unchanged).
            } else {
                // OpenAI-compatible APIs 400 if an assistant tool_calls message isn't immediately
                // followed by matching tool responses — guard against ever sending that shape.
                if (expectedToolCalls.length > 0) {
                    console.warn("[DeepSeek] Missing tool responses detected! Injecting fallback aborts.");
                    expectedToolCalls.forEach(id => {
                        formatted.push({ role: 'tool', name: 'abort', tool_call_id: id, content: JSON.stringify({ error: "User interrupted tool execution." }) });
                    });
                    expectedToolCalls = [];
                }

                let content = msg.content;
                if (Array.isArray(content)) content = content.map(c => c.text || '').join('\n');
                if (!content || (typeof content === 'string' && content.trim() === '')) content = "(silent action completed)";

                formatted.push({
                    role: (msg.role === 'model' || msg.role === 'assistant') ? 'assistant' : msg.role,
                    content
                });
            }
        }

        return formatted;
    }

    static async generateStream(options, app, onChunk) {
        const { apiKey, model, messages, signal, tools, forceToolUse } = options;
        const hasTools = tools && tools.length > 0;

        const formattedMessages = DeepSeek.formatMessages(messages);

        // 🟢 Inject Universal System Instruction for Agent Mode (added to the formatted copy,
        // not the caller's original array — the old code mutated `messages` in place with
        // .unshift(), which is fragile since it's the same array object AgentRunner reuses).
        if (hasTools && !formattedMessages.some(m => m.role === 'system')) {
            formattedMessages.unshift({ role: 'system', content: SYSTEM_INSTRUCTION });
        }

        const reqBody = {
            // 🔴 FIX: 'deepseek-reasoner' (and 'deepseek-chat') are legacy aliases DeepSeek has
            // been retiring — behavior via the alias has been inconsistent. Default to a current
            // model id; this only matters when no model is configured in settings.
            model: model || 'deepseek-v4-flash',
            messages: formattedMessages,
            temperature: model === 'deepseek-reasoner' ? 0.6 : (hasTools ? 0.1 : 0.7),
            stream: true 
        };

        // Think level: OFF / ON (input bar think_how)
        const thinkOn = !!(app?.chatInputUI?.states?.think);
        const thinkLevel = String(app?.chatInputUI?.states?.thinkLevel || 'ON').toUpperCase();
        const wantThinking = thinkOn && thinkLevel !== 'OFF' && thinkLevel !== 'DISABLED';

        // 🟢 Enable Tools for DeepSeek Payload
        if (hasTools) {
            reqBody.tools = tools; // already lowercase-typed by ToolRegistry.getStandardTools()

            // 🟢 Reliability fix: force a tool call in true Agent Mode instead of leaving the
            // model free to just answer in prose. Study-Mode-only turns keep "auto".
            reqBody.tool_choice = forceToolUse ? "required" : "auto";

            if (forceToolUse) {
                // 🔴 DeepSeek rejects tool_choice:"required" while thinking is on
                reqBody.thinking = { type: "disabled" };
            } else if (wantThinking) {
                reqBody.thinking = { type: "enabled" };
            } else if (thinkOn && !wantThinking) {
                reqBody.thinking = { type: "disabled" };
            }
        } else if (wantThinking) {
            reqBody.thinking = { type: "enabled" };
        } else if (thinkOn && !wantThinking) {
            reqBody.thinking = { type: "disabled" };
        }

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(reqBody),
            signal: signal
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `DeepSeek API Error (${response.status})`);
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || "";
            if (content) onChunk(content);
            return { functionCalls: [], rawParts: [{ text: content }] };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = '';
        
        let hasStartedThinking = false;
        let hasFinishedThinking = false;
        
        let currentToolCalls = {}; 
        let textBuffer = "";
        let intercepted = false;

        try {
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

                    if (trimmed.startsWith("data:") && !trimmed.endsWith("[DONE]")) {
                        try {
                            const json = JSON.parse(trimmed.slice(5).trim());
                            const delta = json.choices[0]?.delta;
                            
                            if (delta) {
                                // 1. Handle Reasoning Content (<think>)
                                if (delta.reasoning_content) {
                                    if (!hasStartedThinking) {
                                        onChunk('<think>');
                                        hasStartedThinking = true;
                                    }
                                    onChunk(delta.reasoning_content);
                                }
                                
                                // 2. Handle Normal Text
                                if (delta.content !== undefined && delta.content !== null) {
                                    if (hasStartedThinking && !hasFinishedThinking) {
                                        onChunk('</think>');
                                        hasFinishedThinking = true;
                                    }
                                    if (delta.content !== "") {
                                        textBuffer += delta.content;
                                        onChunk(delta.content);

                                        // 🟢 Early Stream Abort (Token Saver!) — mirrors mistral.js:
                                        // stop paying for tokens the moment the model starts
                                        // dumping code in chat instead of calling a tool.
                                        if (app.isEnableAgentMode && textBuffer.includes('```')) {
                                            intercepted = true;
                                        }
                                    }
                                }

                                // 3. 🟢 Tool Call Parsing (OpenAI compatible)
                                if (delta.tool_calls) {
                                    for (const tc of delta.tool_calls) {
                                        const index = tc.index;
                                        if (!currentToolCalls[index]) {
                                            currentToolCalls[index] = {
                                                id: tc.id,
                                                name: tc.function?.name || "",
                                                argsString: tc.function?.arguments || ""
                                            };
                                        } else {
                                            if (tc.function?.arguments) {
                                                currentToolCalls[index].argsString += tc.function.arguments;
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                }

                if (intercepted) {
                    reader.cancel().catch(() => {});
                    break;
                }
            }
        } finally {
            reader.releaseLock();
            if (hasStartedThinking && !hasFinishedThinking) {
                onChunk('</think>');
            }
        }

        // 🟢 Assemble Tool Calls for AgentRunner
        const toolCallsArray = Object.values(currentToolCalls);
        let parsedFunctionCalls = [];
        if (toolCallsArray.length > 0) {
            parsedFunctionCalls = toolCallsArray.map(tc => {
                let args = {};
                try { args = JSON.parse(tc.argsString); } catch(e) {}
                return { id: tc.id, name: tc.name, args: args };
            });
        }

        let parts = [];
        if (textBuffer) parts.push({ text: textBuffer });
        if (parsedFunctionCalls.length > 0) {
            parts = parts.concat(parsedFunctionCalls.map(fc => ({ functionCall: fc })));
        }

        return {
            functionCalls: parsedFunctionCalls,
            rawParts: parts,
            intercepted
        };
    }
    

    static async fetchModels(apiKey) {
        try {
            const response = await fetch('https://api.deepseek.com/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!response.ok) throw new Error('Failed to fetch models');
            const data = await response.json();
            return data.data ? data.data.map(m => m.id) : [];
        } catch (error) {
            console.error("DeepSeek Fetch Models Error:", error);
            return [];
        }
    }

    static getDocsHTML() {
        const tabsData = [
            {
                title: 'DeepSeek API',
                activeColor: '#4d6bfe',
                default: true,
                content: `
                    <div style="background: rgba(77, 107, 254, 0.1); border-left: 4px solid #4d6bfe; padding: 12px; border-radius: 0 8px 8px 0; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4d6bfe" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                            <polyline points="2 17 12 22 22 17"></polyline>
                            <polyline points="2 12 12 17 22 12"></polyline>
                        </svg>
                        <div>
                            <b style="color: #4d6bfe; font-size: 15px;">DeepSeek API — FULL COMPATIBILITY</b>
                            <p style="margin: 4px 0 0 0; font-size: 11px; color: var(--primary-text-color);">OpenAI Compatible • Base URL: <code>https://api.deepseek.com</code></p>
                        </div>
                    </div>

                    <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <b style="color: #4d6bfe;">Overview</b>
                        <p style="font-size: 11px; margin: 8px 0; white-space: pre-line;">DeepSeek API is 100% compatible with OpenAI's format. You can seamlessly use DeepSeek-V4 (Flash / Pro) models with incredible speed and extremely low pricing.</p>
                        <small style="color:#888; display:block;">Official documentation: <a href="https://platform.deepseek.com/api-docs" target="_blank" style="color:#4caf50;">platform.deepseek.com/api-docs</a></small>
                    </div>

                    <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <b style="color: var(--active-text-color);">Available Models</b>
                        <ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 10.5px; color: var(--secondary-text-color);">
                            <li><code style="color:#4d6bfe;">deepseek-v4-flash</code> → Fast, capable, excellent for coding and general tasks.</li>
                            <li><code style="color:#4d6bfe;">deepseek-v4-pro</code> → Deeper reasoning for complex math, logic, and coding problems.</li>
                            <li><code style="color:#888;">deepseek-chat</code> / <code style="color:#888;">deepseek-reasoner</code> → legacy aliases, being retired — prefer the V4 ids above.</li>
                        </ul>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <b style="color: var(--active-text-color); font-size: 13px;">cURL Request Example</b>
                        <pre style="background:#1e1e1e; padding:10px; margin:8px 0; font-size:10px; border-radius:6px; overflow-x:auto;"><code>curl -X POST https://api.deepseek.com/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "How many r\\'s are in strawberry?"}
    ],
    "stream": true
  }'</code></pre>
                    </div>
                `
            },
            {
                title: 'Thinking Mode',
                activeColor: '#009688',
                content: `
                    <div style="background: rgba(0, 150, 136, 0.1); border-left: 4px solid #009688; padding: 12px; border-radius: 0 8px 8px 0; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#009688" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        <div>
                            <b style="color: #009688; font-size: 15px;">Understanding Thinking Mode</b>
                            <p style="margin: 4px 0 0 0; font-size: 11px; color: var(--primary-text-color);">Chain-of-Thought Reasoning</p>
                        </div>
                    </div>

                    <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <b style="color: #009688;">How it works</b>
                        <p style="font-size: 11px; margin: 8px 0; white-space: pre-line;">DeepSeek's current models output their internal thinking process via a separate <code>reasoning_content</code> field before generating the final answer. Our app natively captures this and wraps it in a beautiful <b>Thinking...</b> bubble!</p>
                    </div>

                    <div style="background: rgba(255, 152, 0, 0.1); padding: 12px; border-radius: 8px; border: 1px solid rgba(255, 152, 0, 0.3); margin-bottom: 20px;">
                        <b style="color: #ff9800;">Agent Mode note</b>
                        <ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 10.5px; color: var(--secondary-text-color);">
                            <li>Thinking Mode is automatically turned off for a request when Agent Mode needs to force a tool call — the two currently can't be combined on DeepSeek's API.</li>
                            <li>Keep Temperature around <b>0.6</b> for best logic performance outside Agent Mode.</li>
                        </ul>
                    </div>
                `
            }
        ];

        return SubTabUI.generate(tabsData);
    }
}