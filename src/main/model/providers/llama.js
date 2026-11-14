// src/main/core/model/chat/Llama.js
import { SYSTEM_INSTRUCTION } from "../SystemPrompt.js";
import { SubTabUI } from '../../ui/SubTabUI.js'; 

export class Llama {
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
            model: model || 'llama-3.3-70b-versatile',
            messages: messages,
            temperature: (tools && tools.length > 0) ? 0.1 : 0.7,
            max_completion_tokens: 4000,
            stream: true 
        };

        // 🟢 Enable Tools for Groq Payload
        if (tools && tools.length > 0) {
            reqBody.tools = tools;
            reqBody.tool_choice = "auto";
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
            throw new Error(errorData.error?.message || `Llama API Error (${response.status})`);
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
        
        let currentToolCalls = {}; 
        let textBuffer = "";

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
    
    static async generateTitle(prompt, apiKey, modelId) {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                model: modelId || 'llama-3.3-70b-versatile', 
                messages: [{role: 'user', content: prompt}], 
                max_tokens: 15 
            })
        });
        const data = await response.json();
        return data.choices?.[0]?.message?.content;
    }
    
    static async fetchModels(apiKey) {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!response.ok) throw new Error('Failed to fetch models');
            const data = await response.json();
            return data.data ? data.data.map(m => m.id) : [];
        } catch (error) {
            console.error("Llama (Groq) Fetch Models Error:", error);
            return [];
        }
    }

    // 🟢 PRO FIX: Using the dynamic SubTabUI Component
    static getDocsHTML() {
        const tabsData = [
            {
                title: 'Meta Llama API',
                activeColor: '#4b5dd1',
                default: true,
                content: `
<div style="padding: 12px; color: var(--primary-text-color); font-size: 12px; line-height: 1.5; overflow-y: auto; max-height: 460px; scrollbar-width: thin;">
        
        <!-- HEADER WITH SVG ICON -->
        <div style="background: rgba(75, 93, 209, 0.1); border-left: 4px solid var(--active-color, #4b5dd1); padding: 12px; border-radius: 0 8px 8px 0; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5dd1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <div>
                <b style="color: var(--active-text-color, #4b5dd1); font-size: 15px;">Llama API — FULL REFERENCE</b>
                <p style="margin: 4px 0 0 0; font-size: 11px; color: var(--primary-text-color);">Preview Release • Base URL: <code>https://api.llama.com/v1</code></p>
            </div>
        </div>

        <!-- OFFICIAL DESCRIPTION -->
        <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px;">
            <b style="color: var(--active-text-color);">Overview</b>
            <p style="font-size: 11px; margin: 8px 0; white-space: pre-line;">
Llama API is currently available as a preview release, with ongoing changes to API endpoints, parameters and models.

The chat completion endpoint generates chat completions for conversation threads using Llama models. This endpoint supports both standard completion requests and integrated tool workflows with optional server-sent event (SSE) streaming for streaming responses.

See chat completion, image understanding, structured output and tool calling for more details on chat completion features, and learn techniques for using chat completion in production in the chat and conversation guide.
            </p>
            <small style="color:#888; display:block;">Full official documentation: <a href="https://llama.developer.meta.com/docs/overview/" target="_blank" style="color:#4caf50;">llama.developer.meta.com/docs/overview/</a></small>
        </div>

        <!-- PLACEHOLDERS -->
        <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px;">
            <b style="color: var(--active-text-color);">Custom API Placeholders</b>
            <ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 10.5px; color: var(--secondary-text-color);">
                <li><code style="color:#4caf50;">{{API_KEY}}</code> → Your Llama API Bearer token</li>
                <li><code style="color:#4caf50;">{{MODEL_ID}}</code> → e.g. Llama-4-Maverick-17B-128E-Instruct-FP8</li>
                <li><code style="color:#4caf50;">{{MESSAGES}}</code> → Full conversation history array</li>
            </ul>
        </div>

        <!-- MAIN ENDPOINT -->
        <div style="margin-bottom: 25px;">
            <b style="color: var(--active-text-color); font-size: 13px;">POST /chat/completions</b>
            <p style="font-size: 11px; margin: 6px 0;">Generate a chat completion for the given messages using the specified model.</p>
            
            <div style="background:#252525; padding:12px; border-radius:8px; margin-bottom:12px;">
                <b style="color:#4caf50; font-size:11px;">Request Body (application/json)</b>
                <div style="font-size:10.5px; line-height:1.5; margin-top:8px;">
                    <div><b>model</b> <span style="color:#666;">string, required</span><br>The identifier of the model to use.</div>
                    <div style="margin-top:6px;"><b>messages</b> <span style="color:#666;">array, required</span><br>List of messages (UserMessage, SystemMessage, ToolResponseMessage, AssistantMessage).</div>
                    <div style="margin-top:6px;"><b>tools</b> <span style="color:#666;">array, optional</span><br>List of tool definitions available to the model.</div>
                    <div style="margin-top:6px;"><b>tool_choice</b> <span style="color:#666;">string | object, optional</span><br>none | auto | required (default: none when no tools, auto when tools present).</div>
                    <div style="margin-top:6px;"><b>response_format</b> <span style="color:#666;">object, optional</span><br>JSON Schema or text format for structured outputs.</div>
                    <div style="margin-top:6px;"><b>stream</b> <span style="color:#666;">boolean, optional</span><br>Enable SSE streaming (default: false).</div>
                    <div style="margin-top:6px;"><b>temperature</b> <span style="color:#666;">number, optional</span><br>Default: 0.6 (max: 1).</div>
                    <div style="margin-top:6px;"><b>top_p</b> <span style="color:#666;">number, optional</span><br>Default: 0.9 (max: 1).</div>
                    <div style="margin-top:6px;"><b>top_k</b> <span style="color:#666;">integer, optional</span></div>
                    <div style="margin-top:6px;"><b>repetition_penalty</b> <span style="color:#666;">number, optional</span><br>Default: 1 (min: 1, max: 2).</div>
                    <div style="margin-top:6px;"><b>max_completion_tokens</b> <span style="color:#666;">integer, optional</span><br>Default: 4096 (min: 1).</div>
                    <div style="margin-top:6px;"><b>user</b> <span style="color:#666;">string, optional</span><br>Unique user identifier for monitoring.</div>
                </div>
            </div>

            <!-- RESPONSE -->
            <div style="background:#252525; padding:12px; border-radius:8px;">
                <b style="color:#4caf50; font-size:11px;">Response</b>
                <p style="font-size:10.5px; margin:8px 0;">HTTP 200 • If stream=false: full CreateChatCompletionResponse<br>If stream=true: SSE stream of chunks (text/event-stream)</p>
                <small style="color:#888;">Contains id, completion_message (role, content, stop_reason, tool_calls), metrics.</small>
            </div>
        </div>

        <!-- CURL EXAMPLES -->
        <div style="margin-bottom: 20px;">
            <b style="color: var(--active-text-color); font-size: 13px;">Text Chat Completion</b>
            <pre style="background:#1e1e1e; padding:10px; margin:8px 0; font-size:10px; border-radius:6px; overflow-x:auto;"><code>curl -X POST https://api.llama.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL_ID}}",
    "messages": [
      {
        "role": "user",
        "content": "Hello, how are you?"
      }
    ],
    "max_completion_tokens": 1024,
    "temperature": 0.7
  }'</code></pre>
        </div>

        <div style="margin-bottom: 20px;">
            <b style="color: var(--active-text-color); font-size: 13px;">Image Understanding (Vision)</b>
            <pre style="background:#1e1e1e; padding:10px; margin:8px 0; font-size:10px; border-radius:6px; overflow-x:auto;"><code>curl -X POST https://api.llama.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL_ID}}",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "What do these two images have in common?"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://upload.wikimedia.org/wikipedia/commons/2/2e/Lama_glama_Laguna_Colorada_2.jpg"
            }
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://upload.wikimedia.org/wikipedia/commons/1/12/Llamas%2C_Laguna_Milluni_y_Nevado_Huayna_Potos%C3%AD_%28La_Paz_-_Bolivia%29.jpg"
            }
          }
        ]
      }
    ]
  }'</code></pre>
        </div>

        <!-- STREAMING NOTE -->
        <div style="background:#1e1e1e; padding:12px; border-radius:8px; margin-bottom:20px;">
            <b style="color: var(--active-text-color);">Streaming Support</b>
            <p style="font-size: 10.5px; margin: 8px 0;">Set <code>"stream": true</code> to receive Server-Sent Events (SSE). Each chunk contains delta content, stop_reason and metrics.</p>
        </div>

        <!-- TOOL & STRUCTURED OUTPUT -->
        <div style="background:#1e1e1e; padding:12px; border-radius:8px;">
            <b style="color: var(--active-text-color);">Tool Calling & Structured Outputs</b>
            <p style="font-size: 10.5px; margin: 8px 0;">Supported via <code>tools</code>, <code>tool_choice</code> and <code>response_format</code> (JSON Schema). Full details in official documentation.</p>
        </div>

        <div style="margin-top: 20px; font-size: 10px; color: #666; text-align: center;">
            Preview API • Ongoing updates • Full docs: <a href="https://llama.developer.meta.com/docs/overview/" target="_blank" style="color:#4caf50;">llama.developer.meta.com</a><br>
        </div>
    </div>
                `
            },
            {
                title: 'Groq API (Fast)',
                activeColor: '#f44336',
                content: `
                    <div style="background: rgba(244, 67, 54, 0.1); border-left: 4px solid #f44336; padding: 12px; border-radius: 0 8px 8px 0; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                        </svg>
                        <div>
                            <b style="color: #f44336; font-size: 15px;">Groq API — FAST INFERENCE</b>
                            <p style="margin: 4px 0 0 0; font-size: 11px; color: var(--primary-text-color);">Lightning Fast • Base URL: <code>https://api.groq.com/openai/v1</code></p>
                        </div>
                    </div>

                    <div style="background: var(--primary-color, rgba(0,0,0,0.2)); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <b style="color: #f44336;">Overview</b>
                        <p style="font-size: 11px; margin: 8px 0; white-space: pre-line;">Groq provides incredibly fast inference for Meta Llama models using their proprietary LPU.</p>
                        <small style="color:#888; display:block;">Get your free API Key: <a href="https://console.groq.com/keys" target="_blank" style="color:#f44336;">console.groq.com/keys</a></small>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <b style="color: var(--active-text-color); font-size: 13px;">Text Chat Completion via Groq</b>
                        <pre style="background:#1e1e1e; padding:10px; margin:8px 0; font-size:10px; border-radius:6px; overflow-x:auto;"><code>curl -X POST https://api.groq.com/openai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL_ID}}",
    "messages": [{"role": "user", "content": "Explain quantum computing."}],
    "stream": true
  }'</code></pre>
                    </div>
                `
            }
        ];

        return SubTabUI.generate(tabsData);
    }
}