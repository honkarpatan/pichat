// src/main/core/model/chat/ChatGPT.js
import { SYSTEM_INSTRUCTION } from "../SystemPrompt.js";
import { ConfigManager } from '../../utils/ConfigManager.js';
import { providerFetch } from '../../utils/network/RateLimitRetry.js';

function loadAdv(modelType = 'chatgpt') {
    try {
        return JSON.parse(ConfigManager.get(`${modelType}ModelOptions`) || '{}') || {};
    } catch (_) {
        return {};
    }
}

export class ChatGPT {
    static async generateStream(options, app, onChunk) {
        const { apiKey, model, messages, signal, tools } = options;
        const adv = loadAdv(app?.selectedModel?.type || 'chatgpt');
        const hasTools = !!(tools && tools.length);

        // 🟢 Inject Universal System Instruction for Agent Mode
        if (hasTools) {
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
            max_tokens: adv.max_tokens != null ? Number(adv.max_tokens) : 4096,
            temperature: hasTools ? 0.1 : (adv.temperature != null ? Number(adv.temperature) : 0.7),
            stream: true
        };

        if (adv.top_p != null) reqBody.top_p = Number(adv.top_p);
        if (adv.presence_penalty != null) reqBody.presence_penalty = Number(adv.presence_penalty);
        if (adv.frequency_penalty != null) reqBody.frequency_penalty = Number(adv.frequency_penalty);
        if (adv.seed != null && Number(adv.seed) > 0) reqBody.seed = Number(adv.seed);

        // Think toggle → reasoning_effort (o1/o3 style models; others may ignore)
        if (app?.chatInputUI?.states?.think) {
            const level = String(app.chatInputUI.states.thinkLevel || adv.reasoning_effort || 'medium').toLowerCase();
            const allowed = ['low', 'medium', 'high'];
            reqBody.reasoning_effort = allowed.includes(level) ? level : 'medium';
        }

        // 🟢 Enable Tools for OpenAI Payload
        if (hasTools) {
            reqBody.tools = tools;
            reqBody.tool_choice = "auto";
        }

        const response = await providerFetch(app, () => fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(reqBody),
            signal: signal
        }), { signal });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `ChatGPT Error (${response.status})`);
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

                            // 🟢 OpenAI Tool Call Parsing (Exact same as Mistral!)
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
    
    // ... [generateImage, fetchModels, generateTitle, getDocsHTML remain the exact same]
    static async generateImage(prompt, apiKey, modelId) {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelId || "dall-e-3",
                prompt: prompt,
                n: 1,
                size: "1024x1024"
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || "Failed to generate image with ChatGPT");
        }

        const data = await response.json();
        return data.data[0].url; 
    }
    
    static async fetchModels(apiKey) {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const data = await response.json();
        return data.data
          ? data.data.map(m => ({
              id: m.id,
              name: m.id,
              description: m.owned_by || '',
              contextLength: null,
              maxOutput: null,
              supportsTools: /gpt-4|gpt-5|o[0-9]|codex/i.test(m.id || '')
            }))
          : [];
    }

    static async generateTitle(prompt, apiKey, modelId) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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
                    <li><code style="color:#4caf50;">{{API_KEY}}</code> : Injects your saved OpenAI API Key.</li>
                    <li><code style="color:#4caf50;">{{MODEL_ID}}</code> : Injects your selected Model ID.</li>
                    <li><code style="color:#f44; font-weight:bold;">"{{MESSAGES}}"</code> : <b>CRITICAL!</b> App replaces this with your chat history.</li>
                </ul>
            </div>

            <div style="margin-top: 10px; background: var(--primary-color, rgba(0,0,0,0.2)); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
                <b style="color: var(--active-text-color);">1. Force JSON Output (JSON Mode)</b>
                <p style="margin: 4px 0; font-size: 10.5px; color: var(--secondary-text-color);">Guarantees the message the model generates is a valid JSON object. <i>Note: You must still instruct the model to produce JSON via prompt.</i></p>
                <textarea readonly spellcheck="false" style="width:100%; background: #111; color: #4caf50; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 10px; border: 1px solid #333; resize: none; height: 50px; outline:none;">"response_format": { 
  "type": "json_object" 
}</textarea>
            </div>

            <div style="margin-top: 10px; background: var(--primary-color, rgba(0,0,0,0.2)); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
                <b style="color: var(--active-text-color);">2. Reasoning Effort (o-series models)</b>
                <p style="margin: 4px 0; font-size: 10.5px; color: var(--secondary-text-color);">Constrains effort on reasoning for models like <code style="color:#ccc;">o1</code> or <code style="color:#ccc;">o3-mini</code>. Values: <code style="color:#f44;">low</code>, <code style="color:#f44;">medium</code>, <code style="color:#f44;">high</code>.</p>
                <textarea readonly spellcheck="false" style="width:100%; background: #111; color: #4caf50; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 10px; border: 1px solid #333; resize: none; height: 35px; outline:none;">"reasoning_effort": "high"</textarea>
            </div>

            <div style="margin-top: 10px; background: var(--primary-color, rgba(0,0,0,0.2)); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
                <b style="color: var(--active-text-color);">3. Text Diversity (Penalties)</b>
                <p style="margin: 4px 0; font-size: 10.5px; color: var(--secondary-text-color);">Penalize new tokens based on existing frequency to reduce repetition. Values from <code style="color:#ccc;">-2.0</code> to <code style="color:#ccc;">2.0</code>.</p>
                <textarea readonly spellcheck="false" style="width:100%; background: #111; color: #4caf50; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 10px; border: 1px solid #333; resize: none; height: 50px; outline:none;">"presence_penalty": 0.5,
"frequency_penalty": 0.3</textarea>
            </div>

            <h4 style="margin-top: 18px; margin-bottom: 6px; color: var(--secondary-text-color); border-bottom: 1px solid var(--border-color); padding-bottom: 4px; text-transform: uppercase; font-size:10px;">More Resources</h4>
            <a href="https://platform.openai.com/docs/api-reference/chat" target="_blank" style="color: var(--active-text-color); text-decoration: none; font-weight: bold; font-size: 11px;">Official OpenAI API Documentation ↗</a>
        </div>
        `;
    }
}