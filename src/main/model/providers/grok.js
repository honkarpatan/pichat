// src/main/core/model/chat/Grok.js
import { SYSTEM_INSTRUCTION } from "../SystemPrompt.js";

export class Grok {
    static async generateStream(options, app, onChunk) {
        const { apiKey, model, messages, signal, tools } = options;

        // 🟢 Inject Universal System Instruction for Agent Mode
        if (tools && tools.length > 0) {
            const hasSystem = messages.some(m => m.role === 'system');
            if (!hasSystem) {
                messages.unshift({
                    role: 'system',
                    content: SYSTEM_INSTRUCTION
                });
            }
        }

        const reqBody = {
            model: model,
            messages: messages,
            max_tokens: 4000,
            temperature: (tools && tools.length > 0) ? 0.1 : 0.7,
            stream: true 
        };

        // Think toggle → reasoning power (reasoning models may honor this)
        if (app?.chatInputUI?.states?.think) {
            const level = String(app.chatInputUI.states.thinkLevel || 'medium').toLowerCase();
            const allowed = ['low', 'medium', 'high'];
            reqBody.reasoning_effort = allowed.includes(level) ? level : 'medium';
        }

        // 🟢 Enable Tools for Grok Payload
        if (tools && tools.length > 0) {
            reqBody.tools = tools;
            reqBody.tool_choice = "auto";
        }

        // Grok API Endpoint
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
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
            throw new Error(errorData.error?.message || `Grok API Error (${response.status})`);
        }

        // 🟢 Non-Streaming Support (Smart Fallback)
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
        
        let currentToolCalls = {}; 
        let textBuffer = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split("\n");
                buffer = lines.pop(); // Keep incomplete chunk
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    if (trimmed.startsWith("data:") && !trimmed.endsWith("[DONE]")) {
                        try {
                            const json = JSON.parse(trimmed.slice(5).trim());
                            const delta = json.choices[0]?.delta;
                            if (!delta) continue;

                            // Normal Text Streaming
                            if (delta.content) {
                                textBuffer += delta.content;
                                onChunk(delta.content); 
                            }

                            // 🟢 Tool Call Parsing (OpenAI compatible)
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
                        } catch (e) {}
                    }
                }
            }
        } finally {
            reader.releaseLock();
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
            rawParts: parts 
        };
    }
    
    static async generateImage(prompt, apiKey, modelId) {
        throw new Error("xAI currently does not support direct Image Generation via public API.");
    }
    
    static async fetchModels(apiKey) {
        const response = await fetch('https://api.x.ai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const data = await response.json();
        return data.data ? data.data.map(m => m.id) : [];
    }

    static async generateTitle(prompt, apiKey, modelId) {
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelId, messages: [{role: 'user', content: prompt}], max_tokens: 15 })
        });
        const data = await response.json();
        return data.choices?.[0]?.message?.content;
    }
  
    // ... [getDocsHTML remains exactly the same as provided]
    static getDocsHTML() {
    return `
    <div style="padding: 12px; color: var(--primary-text-color); font-size: 12px; line-height: 1.5; overflow-y: auto; max-height: 420px; scrollbar-width: thin;">
        
        <!-- HEADER -->
        <div style="background: rgba(75, 93, 209, 0.1); border-left: 4px solid var(--active-color, #4b5dd1); padding: 12px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
            <b style="color: var(--active-text-color, #4b5dd1); font-size: 15px;">xAI Grok API</b>
            <p style="margin: 8px 0 0 0; font-size: 11px; color: var(--primary-text-color);">
                100% OpenAI-compatible • Base: <code>https://api.x.ai/v1</code><br>
                Get API key: <a href="https://console.x.ai/team/default/api-keys" target="_blank" style="color:#4caf50; text-decoration:underline;">console.x.ai</a>
            </p>
        </div>

        <!-- PLACEHOLDERS -->
        <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px;">
            <b style="color: var(--active-text-color);">⚙ Custom API Placeholders (for your app)</b>
            <ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 10.5px; color: var(--secondary-text-color);">
                <li><code style="color:#4caf50;">{{API_KEY}}</code> → Your Bearer token</li>
                <li><code style="color:#4caf50;">{{MODEL_ID}}</code> → e.g. grok-4.20-reasoning</li>
                <li><code style="color:#f44; font-weight:bold;">{{MESSAGES}}</code> or <code>{{INPUT}}</code> → Full chat history</li>
                <li><code style="color:#4caf50;">{{BASE_URL}}</code> → https://api.x.ai/v1</li>
            </ul>
        </div>

        <!-- AUTH -->
        <div style="margin-bottom: 20px;">
            <b style="color: var(--active-text-color); font-size: 13px;">Authentication</b>
            <p style="font-size: 11px; margin: 6px 0;">Every request needs:</p>
            <pre style="background:#1e1e1e; padding:10px; border-radius:6px; font-size:10px; overflow-x:auto;"><code>-H "Authorization: Bearer {{API_KEY}}"</code></pre>
        </div>

        <!-- MODELS -->
        <div style="margin-bottom: 20px;">
            <b style="color: var(--active-text-color); font-size: 13px;">Current Models (2026)</b>
            <div style="background:#1e1e1e; padding:10px; border-radius:6px; font-size:10.5px; line-height:1.4;">
                <b style="color:#4caf50;">Text / Reasoning (2M context)</b><br>
                • grok-4.20-0309-reasoning<br>
                • grok-4.20-0309-non-reasoning<br>
                • grok-4.20-multi-agent-0309<br>
                • grok-4-1-fast-reasoning<br><br>
                
                <b style="color:#4caf50;">Image Generation</b><br>
                • grok-imagine-image-pro ($0.07/image)<br>
                • grok-imagine-image ($0.02/image)<br><br>
                
                <b style="color:#4caf50;">Video & Voice</b><br>
                • grok-imagine-video<br>
                • Voice Agent API (WebSocket)<br>
                • Text-to-Speech
            </div>
            <small style="color:#888; margin-top:4px; display:block;">All Grok-4 models support 2,000,000 token context + native tools.</small>
        </div>

        <!-- MAIN ENDPOINTS -->
        <div style="margin-bottom: 25px;">
            <b style="color: var(--active-text-color); font-size: 13px;">Primary Endpoints</b>
            
            <!-- CHAT COMPLETIONS (Legacy OpenAI style) -->
            <div style="margin-top:12px; background:#252525; padding:12px; border-radius:8px;">
                <b style="color:#ff9800;">POST /v1/chat/completions</b> <span style="font-size:10px; color:#666;">(OpenAI format — still fully supported)</span>
                <pre style="background:#1e1e1e; padding:8px; margin:8px 0; font-size:10px; border-radius:4px;"><code>curl https://api.x.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL_ID}}",
    "messages": {{MESSAGES}},
    "temperature": 0.7,
    "max_tokens": 1024,
    "stream": false
  }'</code></pre>
                <small>Supports: vision (image_url), tools, streaming, structured outputs.</small>
            </div>

            <!-- NEW RESPONSES API (Recommended) -->
            <div style="margin-top:12px; background:#252525; padding:12px; border-radius:8px;">
                <b style="color:#4caf50;">POST /v1/responses</b> <span style="font-size:10px; color:#666;">(New xAI format — richer features)</span>
                <pre style="background:#1e1e1e; padding:8px; margin:8px 0; font-size:10px; border-radius:4px;"><code>curl https://api.x.ai/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL_ID}}",
    "input": [
      {"role": "system", "content": "You are Grok..."},
      {"role": "user", "content": "Explain quantum computing"}
    ],
    "tools": [{"type": "web_search"}]
  }'</code></pre>
                <small>input = messages | supports reasoning, multi-agent, image + text content.</small>
            </div>
        </div>

        <!-- VISION EXAMPLE -->
        <div style="margin-bottom: 20px;">
            <b style="color: var(--active-text-color);"> Vision (Image Understanding)</b>
            <pre style="background:#1e1e1e; padding:10px; font-size:10px; border-radius:6px;"><code>curl https://api.x.ai/v1/responses \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "grok-4.20-reasoning",
    "input": [{
      "role": "user",
      "content": [
        {"type": "input_image", "image_url": "https://example.com/image.jpg"},
        {"type": "input_text", "text": "What is happening here?"}
      ]
    }]
  }'</code></pre>
        </div>

        <!-- STREAMING -->
        <div style="margin-bottom: 20px;">
            <b style="color: var(--active-text-color);">Streaming Example</b>
            <pre style="background:#1e1e1e; padding:10px; font-size:10px; border-radius:6px;"><code>curl https://api.x.ai/v1/chat/completions \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL_ID}}",
    "messages": {{MESSAGES}},
    "stream": true
  }'</code></pre>
            <small>Response is SSE stream (data: {chunk} lines)</small>
        </div>

        <!-- TOOLS / FUNCTION CALLING -->
        <div style="margin-bottom: 20px;">
            <b style="color: var(--active-text-color);"> Tools & Function Calling</b>
            <pre style="background:#1e1e1e; padding:10px; font-size:10px; border-radius:6px;"><code>{
  "tools": [
    {"type": "web_search"},
    {"type": "function", "name": "get_weather", ...}
  ]
}</code></pre>
        </div>

        <!-- IMAGE GENERATION -->
        <div style="margin-bottom: 20px;">
            <b style="color: var(--active-text-color);">Image Generation</b>
            <pre style="background:#1e1e1e; padding:10px; font-size:10px; border-radius:6px;"><code>curl https://api.x.ai/v1/images/generations \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "grok-imagine-image",
    "prompt": "A cyberpunk cat riding a motorcycle on Mars"
  }'</code></pre>
        </div>

        <div style="margin-top: 20px; font-size: 10px; color: #666; text-align: center;">
            Full docs: <a href="https://docs.x.ai" target="_blank" style="color:#4caf50;">docs.x.ai</a><br>
        </div>
    </div>
    `;
}
}